const AWS = require('aws-sdk');
const https = require('https');
const config = require('../config/config');
const logger = require('../config/logger');

// Create a connection pool
const agent = new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    rejectUnauthorized: true
});

class SQSService {
    constructor() {
        try {
            // Configure AWS SDK for maximum performance
            this.sqs = new AWS.SQS({
                region: config.aws.CUSTOM_AWS_REGION,
                accessKeyId: config.aws.CUSTOM_AWS_ACCESS_KEY,
                secretAccessKey: config.aws.CUSTOM_AWS_SECRET_ACCESS,
                apiVersion: '2012-11-05',
                maxRetries: 1,
                httpOptions: {
                    timeout: 2000,
                    connectTimeout: 1000,
                    agent  // Use the shared connection pool
                }
            });

            this.queueUrl = `https://sqs.${config.aws.CUSTOM_AWS_REGION}.amazonaws.com/014498623548/${config.aws.SQS_QUEUE_NAME}`;
            if (!this.queueUrl) {
                throw new Error('SQS_QUEUE_URL is not defined');
            }
        } catch (error) {
            throw error;
        }
    }

    async sendMessage(messageBody) {
        if (!messageBody) {
            throw new Error('Message body is required');
        }
        try {
            const params = {
                QueueUrl: this.queueUrl,
                MessageBody: JSON.stringify(messageBody),
            };

            logger.info('Sending message to SQS', { queueUrl: this.queueUrl, messageBody });
            const result = await this.sqs.sendMessage(params).promise();
            logger.info('Message sent successfully', { messageId: result.MessageId });
            return result.MessageId;
        } catch (error) {
            logger.error('Failed to send message to SQS:', {
                error: error.message,
                code: error.code,
                requestId: error.requestId,
                queueUrl: this.queueUrl
            });
            throw error;
        }
    }

    async sendMessageBatch(messages, fromName, subject, retryCount = 0) {
        if (!messages?.length || messages.length > 10) {
            throw new Error('Invalid batch size');
        }

        try {
            const entries = messages.map((message, index) => ({
                Id: `msg${index}`,
                MessageBody: JSON.stringify(message),
                MessageAttributes: {
                    FromName: {
                        DataType: 'String',
                        StringValue: fromName
                    },
                    Subject: {
                        DataType: 'String',
                        StringValue: subject
                    }
                }
            }));
            console.log("MessageBody", entries[0].MessageBody, entries[0].MessageAttributes)
            const params = {
                QueueUrl: this.queueUrl,
                Entries: entries
            };

            const result = await this.sqs.sendMessageBatch(params).promise();

            if (result.Failed?.length) {
                if (retryCount < 2) { // Try up to 2 times
                    const failedMessages = result.Failed.map(f =>
                        messages[parseInt(f.Id.replace('msg', ''))]);

                    // Immediate retry for throttling, slight delay for other errors
                    const delay = result.Failed.some(f => f.SenderFault) ? 200 : 50;
                    await new Promise(resolve => setTimeout(resolve, delay));

                    const retryResult = await this.sendMessageBatch(failedMessages, fromName, subject, retryCount + 1);
                    return [...result.Successful.map(msg => msg.MessageId), ...retryResult];
                }

                const errors = result.Failed.map(f => `${f.Id}: ${f.Message}`).join(', ');
                throw new Error(`Failed to send messages after retries: ${errors}`);
            }

            return result.Successful.map(msg => msg.MessageId);
        } catch (error) {
            if (error.code === 'ThrottlingException' && retryCount < 2) {
                await new Promise(resolve => setTimeout(resolve, 100));
                return this.sendMessageBatch(messages, fromName, subject, retryCount + 1);
            }
            throw error;
        }
    }
}

module.exports = SQSService;
