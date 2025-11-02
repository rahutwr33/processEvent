const jwt = require("jsonwebtoken");

const centerHtmlContent = (html) => {
    return `<html><body>${html}</body></html>`
}

// Generate the unsubscribe link
const generateUnsubscribeLink = (email, campaignId) => {
    if (!email || !campaignId) {
        throw new Error('Email and campaignId is required');
    }

    try {
        const token = jwt.sign({ email, campaignId }, process.env.UNSUBSCRIBE_SECRET_KEY, {
            expiresIn: '180d',
            algorithm: 'HS256' // explicitly specify the algorithm
        });
        return `${process.env.SERVER_URL}/v1/unsubscribe/${token}`;
    } catch (error) {
        logger.info('Error generating unsubscribe token:', error);
        return null;
    }
}


// forward Campaign Link
const generateForwardLink = (campaignId) => {
    if (!campaignId) {
        throw new Error('CampaignId is required');
    }

    try {
        const token = jwt.sign({ campaignId }, process.env.FORWARD_SECRET_KEY, {
            expiresIn: '180d',
            algorithm: 'HS256' // explicitly specify the algorithm
        });
        return `${process.env.SERVER_URL}/v1/forward/${token}`
    } catch (error) {
        logger.info('Error generating unsubscribe token:', error);
        return null;
    }
}


// Decode the unsubscribe link token
const decodeUnsubscribeLink = (token) => {
    if (!token) {
        throw new Error('Token is required');
    }

    try {
        const decoded = jwt.verify(token, process.env.UNSUBSCRIBE_SECRET_KEY);
        return decoded.email;
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return null;
        } else if (error instanceof jwt.JsonWebTokenError) {
            return null;
        }
        return null;
    }
}

// Decode the forward link token
const decodeForwardLink = (token) => {
    if (!token) {
        return null;
    }
    try {
        const decoded = jwt.verify(token, process.env.FORWARD_SECRET_KEY);
        return {
            campaignId: decoded.campaignId,
            userId: decoded.userId
        };
    } catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            return null;
        } else if (error instanceof jwt.JsonWebTokenError) {
            return null;
        }
        return null;
    }
}

const isValidUrl = (url) => {
    const pattern = new RegExp('^(https?:\\/\\/)?' + // protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])?)\\.)+[a-z]{2,}|' + // domain name
        'localhost|' + // localhost
        '\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}|' + // ipv4
        '\\[?[a-fA-F0-9]*:[a-fA-F0-9:]+\\]?)' + // ipv6
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
        '(\\#[-a-z\\d_]*)?$', 'i'); // fragment locator
    return !!pattern.test(url);
}
const isValidEmail = (email) => {
    const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return pattern.test(email);
}

// Helper function to chunk array into smaller arrays
const chunkArray = (array, chunkSize) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
};

module.exports = {
    centerHtmlContent,
    generateUnsubscribeLink,
    decodeUnsubscribeLink,
    generateForwardLink,
    decodeForwardLink,
    isValidUrl,
    isValidEmail,
    chunkArray
}
