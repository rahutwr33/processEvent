const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./logger');

let isConnected = false;
let retryAttempted = false;

// Set up mongoose event listeners
mongoose.connection.on('connected', () => {
    isConnected = true;
    retryAttempted = false; // Reset retry flag on successful connection
    logger.info('MongoDB connected successfully');
});

mongoose.connection.on('error', (err) => {
    isConnected = false;
    logger.error('MongoDB connection error:', err);
});

mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
    isConnected = true;
    logger.info('MongoDB reconnected');
});

// Handle process termination
process.on('SIGINT', async () => {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed due to application termination');
    process.exit(0);
});

const connectToDatabase = async () => {
    if (isConnected && mongoose.connection.readyState === 1) {
        logger.info('Using existing database connection');
        return;
    }

    try {
        await mongoose.connect(config.mongoose.url, config.mongoose.options);
        isConnected = true;
        retryAttempted = false;
        logger.info('Connected to MongoDB');
    } catch (err) {
        logger.error('MongoDB connection error:', err);

        // Retry once if not already attempted
        if (!retryAttempted) {
            retryAttempted = true;
            logger.info('Retrying MongoDB connection...');

            try {
                // Wait 2 seconds before retry
                await new Promise(resolve => setTimeout(resolve, 2000));
                await mongoose.connect(config.mongoose.url, config.mongoose.options);
                isConnected = true;
                retryAttempted = false;
                logger.info('MongoDB connection successful after retry');
            } catch (retryErr) {
                retryAttempted = false; // Reset for future attempts
                logger.error('MongoDB connection retry failed:', retryErr);
                throw retryErr;
            }
        } else {
            throw err;
        }
    }
};

module.exports = { connectToDatabase };

