const { connectToDatabase } = require('./src/config/db');
const {
    sendCampaignToAllContact,
    sendCampaignToGroups
} = require("./src/services/sendcampaign.service");
const CampaignSend = require("./src/models/campaignSend.model");
const Campaign = require("./src/models/campaign.model");
exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    await connectToDatabase();

    const sendCampaign = await CampaignSend.find({
        status: 'InProgress',
        $or: [
            { scheduleTime: { $lt: new Date() } },
            { scheduleTime: null },
            { scheduleTime: { $exists: false } }
        ]
    }).limit(10);
    if (sendCampaign.length === 0) {
        return {
            statusCode: 200
        };
    }
    for (const campaignSend of sendCampaign) {
        // delay 1 second
        await new Promise(resolve => setTimeout(resolve, 1000));
        const { options, campaignId, userId, statsId, groups, fromName, subject } = campaignSend;
        const campaign = await Campaign.findById(campaignId).select('htmlcontent  _id');
        if (options > 1 || !campaign || !userId || !statsId || !fromName || !subject) {
            return { statusCode: 400, body: JSON.stringify({ message: 'Missing options or payload' }) };
        }
        if (options === 1) {
            await sendCampaignToAllContact(campaign, userId, statsId, fromName, subject);
        } else {
            await sendCampaignToGroups(campaign, userId, statsId, groups, fromName, subject);
        }

        // Update statuses to Queued after successful processing
        await CampaignSend.findByIdAndUpdate(campaignSend._id, { status: 'Queued' });
        await Campaign.findByIdAndUpdate(campaignId, { status: 'Queued' });
    }
    return {
        statusCode: 200
    };
}

