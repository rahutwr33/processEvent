const { connectToDatabase } = require('./src/config/db');
const {
    sendCampaignToAllContact,
    sendCampaignToGroups
} = require("./src/services/sendcampaign.service");

exports.handler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    console.log("event", event);
    await connectToDatabase();
    const { options, campaign, userId, statsId, groups, fromName, subject } = event;
    if (options > 1 || !campaign || !userId || !statsId || !fromName || !subject) return { statusCode: 400, body: JSON.stringify({ message: 'Missing options or payload' }) };
    if (options === 1) {
        await sendCampaignToAllContact(campaign, userId, statsId, fromName, subject);
    } else {
        await sendCampaignToGroups(campaign, userId, statsId, groups, fromName, subject);
    }
    return {
        statusCode: 200
    };
}

