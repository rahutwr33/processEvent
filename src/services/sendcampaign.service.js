const Contact = require('../models/contact.model');
const Group = require('../models/group.model');
const he = require('he');
const cheerio = require("cheerio");
const { addFooter } = require('../utils/template');
const SQSService = require('./queue.servie');
const FailedSQSMessage = require('../models/failedMessage.model');
const logger = require('../config/logger');
const config = require('../config/config');
const BASE_URL = config.server.url;
const mongoose = require('mongoose');

// Helper function to send messages with maximum concurrency
const sendMessagesWithRetry = async (sqsService, messages, fromName, subject) => {
    const failedMessages = [];
    let processedCount = 0;

    // Process messages in parallel with maximum concurrency
    const processMessageBatch = async (messageBatch) => {
        try {
            await sqsService.sendMessageBatch(messageBatch, fromName, subject);
            processedCount += messageBatch.length;
            return true;
        } catch (error) {
            if (error.code === 'ThrottlingException') {
                // Immediate retry once on throttling
                try {
                    await new Promise(resolve => setTimeout(resolve, 50));
                    await sqsService.sendMessageBatch(messageBatch, fromName, subject);
                    processedCount += messageBatch.length;
                    return true;
                } catch (retryError) {
                    failedMessages.push(...messageBatch);
                    return false;
                }
            }
            failedMessages.push(...messageBatch);
            return false;
        }
    };

    // Process messages in optimal batch sizes
    const BATCH_SIZE = 10; // AWS SQS limit
    const batches = [];

    // Create batches efficiently
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
        batches.push(messages.slice(i, i + BATCH_SIZE));
    }

    // Process all batches with maximum concurrency
    const results = await Promise.all(
        batches.map(batch => processMessageBatch(batch))
    );

    return failedMessages;
};

const validateInput = (campaign, userId) => {
    if (!campaign || !campaign._id || !campaign.htmlcontent) {
        throw new Error('Invalid campaign data');
    }
    if (!userId) {
        throw new Error('UserId is required');
    }
};

const addImage = (email = '', id) => {
    return `<img src="${BASE_URL}/v1/stats?id=${id}&type=open&email=${email}" alt="main-image" width="1" height="1" style="display:none;" />`;
}

const processLinks = (htmlStr, email = '', id) => {
    const $ = cheerio.load(htmlStr);
    $('a img').each((index, img) => {
        const $img = $(img);
        const $anchor = $img.closest('a');
        const originalHref = $anchor.attr('href');
        const encodedRedirect = encodeURIComponent(originalHref);
        const newHref = `${BASE_URL}/v1/stats?redirect=${encodedRedirect}&url=${originalHref}&email=${email}&type=click&id=${id}`;

        // Set new anchor attributes
        $anchor.attr({
            'href': newHref,
            'title': originalHref,
            'rel': originalHref.match(/\+?\d{10,}/)?.[0] || '',
            'target': '_blank',
            'data-saferedirecturl': newHref
        });

        // Update image attributes
        $img.attr({
            'class': 'CToWUd',
            'data-bit': 'iit'
        });
    });
    $('a').each((index, anchor) => {
        const $anchor = $(anchor);
        const href = $anchor.attr('href');
        if (href.startsWith('=')) {
            $anchor.attr('href', href.replace('=', ''));
        }
    });
    $('img').each((index, img) => {
        const $img = $(img);
        const src = $img.attr('src');
        if (src.startsWith('=')) {
            $img.attr('src', src.replace('=', ''));
        }
    });
    return $.html();
}

const prepareCampaignHtml = (htmlContent, email, statsId) => {
    try {
        const decodedHtml = he.decode(htmlContent);
        const $ = cheerio.load(decodedHtml, {
            xmlMode: false,
            decodeEntities: true
        });

        // Remove potentially problematic elements
        $('script, iframe').remove();

        // Clean up nested tags
        $('html html, body body, head head').each(function () {
            $(this).replaceWith($(this).html());
        });

        return $.html();
    } catch (error) {
        logger.error('HTML preparation failed:', error);
        throw new Error('Failed to prepare campaign HTML');
    }
};

const sendCampaignToAllContact = async (campaign, userId, statsId, fromName, subject) => {
    try {
        // Input validation
        validateInput(campaign, userId);
        const startTime = Date.now();
        logger.info('Starting campaign send process', {
            campaignId: campaign._id,
            userId,
            timestamp: new Date().toISOString()
        });

        // Get total count of contacts first
        const totalContacts = await Contact.countDocuments({
            userId: userId,
            active: true,
            email: { $exists: true, $ne: '' } // Ensure valid emails only
        });

        if (totalContacts === 0) {
            logger.warn('No active contacts found', { campaignId: campaign._id, userId });
            return { success: true, sentCount: 0, message: 'No active contacts found' };
        }
        // Prepare HTML content once for all contacts with safety measures
        const baseHtml = prepareCampaignHtml(campaign.htmlcontent, statsId);

        // Process in large chunks for maximum speed
        const CONTACT_CHUNK_SIZE = 1000; // Increased for better performance
        let processedCount = 0;
        let failedCount = 0;

        // Get contacts in chunks
        for (let skip = 0; skip < totalContacts; skip += CONTACT_CHUNK_SIZE) {
            const chunkIndex = skip / CONTACT_CHUNK_SIZE;
            const contacts = await Contact.find({
                userId: userId,
                active: true,
                email: { $exists: true, $ne: '' }
            })
                .select('email')
                .skip(skip)
                .limit(CONTACT_CHUNK_SIZE)
                .lean(); // Use lean for better performance

            if (!contacts.length) continue;
            // Process all contacts in this chunk efficiently with email validation
            const totalMails = contacts
                .map(contact => (JSON.stringify(processLinks(baseHtml.replace('</body>',
                    `${addFooter(contact.email, campaign._id)}${addImage(contact.email, statsId)}</body>`),
                    contact.email, statsId))));
            const batchStartTime = Date.now();
            const sqsService = new SQSService();
            try {
                // Send to SQS with automatic retries in the queue service
                const failedMessages = await sendMessagesWithRetry(sqsService, totalMails, fromName, subject);
                processedCount += (totalMails.length - failedMessages.length); // Only count successful
                const chunkDuration = Date.now() - batchStartTime;
                if (failedMessages.length > 0) {
                    logger.warn('Some messages failed to send after retries', {
                        failedCount: failedMessages.length,
                        totalCount: totalMails.length,
                        chunkIndex,
                        campaignId: campaign._id,
                        duration: `${chunkDuration}ms`
                    });
                    // Store failed messages for later retry
                    const failedBulkOps = failedMessages.map(msg => ({
                        insertOne: {
                            document: new FailedSQSMessage({
                                campaignId: campaign._id,
                                payload: msg
                            })
                        }
                    }));

                    // Use bulk operation for better performance
                    await FailedSQSMessage.bulkWrite(failedBulkOps, { ordered: false })
                        .catch(error => {
                            logger.error('Failed to store failed messages', {
                                error: error.message,
                                campaignId: campaign._id,
                                failedCount: failedMessages.length
                            });
                        });
                }
                // No rate limiting for maximum speed
            } catch (error) {
                logger.error('Chunk processing failed', {
                    chunkIndex,
                    error: error.message,
                    campaignId: campaign._id
                });
                failedCount += totalMails.length;
            }
        }

        const totalDuration = Date.now() - startTime;
        const result = {
            success: true,
            campaignId: campaign._id,
            totalContacts,
            processedCount,
            failedCount,
            duration: `${totalDuration}ms`,
            timestamp: new Date().toISOString()
        };
        logger.info('Campaign processing completed', result);
        return result;
    } catch (error) {
        const errorDetails = {
            campaignId: campaign?._id,
            userId,
            error: error.message,
            code: error.code,
            stack: error.stack,
            timestamp: new Date().toISOString()
        };
        logger.error('Campaign processing error', errorDetails);
    }
}

const sendCampaignToGroups = async (campaign, userId, statsId, groupIds, fromName, subject) => {
    try {
        validateInput(campaign, userId);

        // Validate groupIds parameter
        if (groupIds && !Array.isArray(groupIds)) {
            throw new Error('groupIds must be an array');
        }

        const startTime = Date.now();
        logger.info('Starting campaign send to groups', {
            campaignId: campaign._id,
            userId,
            groupIds: groupIds?.length || 'all',
            timestamp: new Date().toISOString()
        });

        // Step 1: Get groups efficiently
        const query = {
            userId: new mongoose.mongo.ObjectId(userId),
            contacts: { $exists: true, $not: { $size: 0 } }
        };
        if (Array.isArray(groupIds) && groupIds.length > 0) {
            query._id = { $in: groupIds.map(id => new mongoose.mongo.ObjectId(id)) };
        }

        console.log("query", query);

        const groups = await Group.find(query)
            .select('contacts')
            .lean();

        console.log("groups", groups);

        if (!groups.length) {
            return { success: true, sentCount: 0, message: 'No groups found' };
        }

        // Step 2: Get all contact IDs from groups
        const contactIds = groups.flatMap(group => group.contacts);

        if (!contactIds.length) {
            return { success: true, sentCount: 0, message: 'No contacts in groups' };
        }


        // Step 3: Query contacts with chunking for large datasets
        const CONTACT_CHUNK_SIZE = 1000;
        let processedCount = 0;
        let failedCount = 0;

        for (let skip = 0; skip < contactIds.length; skip += CONTACT_CHUNK_SIZE) {
            const contactChunk = contactIds.slice(skip, skip + CONTACT_CHUNK_SIZE);

            const contacts = await Contact.find({
                _id: { $in: contactChunk },
                userId: userId,
                active: true,
                email: { $exists: true, $ne: '' }
            })
                .select('email')
                .lean();

            if (!contacts.length) continue;

            const baseHtml = prepareCampaignHtml(campaign.htmlcontent, statsId);

            const totalMails = contacts
                .map(contact => (JSON.stringify(processLinks(baseHtml.replace('</body>',
                    `${addFooter(contact.email, campaign._id)}${addImage(contact.email, statsId)}</body>`),
                    contact.email, statsId))));

            const sqsService = new SQSService();
            const chunkStartTime = Date.now();

            try {
                const failedMessages = await sendMessagesWithRetry(sqsService, totalMails);
                processedCount += (totalMails.length - failedMessages.length);
                failedCount += failedMessages.length;

                const chunkDuration = Date.now() - chunkStartTime;

                if (failedMessages.length > 0) {
                    logger.warn('Some messages failed to send after retries', {
                        failedCount: failedMessages.length,
                        totalCount: totalMails.length,
                        campaignId: campaign._id,
                        duration: `${chunkDuration}ms`
                    });

                    const failedBulkOps = failedMessages.map(msg => ({
                        insertOne: {
                            document: new FailedSQSMessage({
                                campaignId: campaign._id,
                                payload: msg
                            })
                        }
                    }));

                    await FailedSQSMessage.bulkWrite(failedBulkOps, { ordered: false })
                        .catch(error => {
                            logger.error('Failed to store failed messages', {
                                error: error.message,
                                campaignId: campaign._id,
                                failedCount: failedMessages.length
                            });
                        });
                }
            } catch (error) {
                logger.error('Chunk processing failed', {
                    error: error.message,
                    campaignId: campaign._id
                });
                failedCount += totalMails.length;
            }
        }

        const totalDuration = Date.now() - startTime;
        const result = {
            success: true,
            campaignId: campaign._id,
            processedCount,
            failedCount,
            duration: `${totalDuration}ms`,
            timestamp: new Date().toISOString()
        };

        logger.info('Campaign processing to groups completed', result);
        return result;

    } catch (err) {
        const errorDetails = {
            campaignId: campaign?._id,
            userId,
            groupIds,
            error: err.message,
            code: err.code,
            stack: err.stack,
            timestamp: new Date().toISOString()
        };
        logger.error('Failed to send messages to groups', errorDetails);

        // Return error response instead of undefined
        return {
            success: false,
            error: err.message,
            campaignId: campaign?._id,
            userId,
            timestamp: new Date().toISOString()
        };
    }
}



module.exports = {
    sendCampaignToAllContact,
    sendCampaignToGroups
};