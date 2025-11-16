const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const EmailLogSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "User"
    },
    campaignId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "Campaign"
    },
    email: {
        type: String,
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ["queued", "sent", "delivered", "bounced", "failed"],
        required: true,
        default: "queued"
    },

    providerMessageId: {
        type: String,
        default: ""
    },

    errorMessage: {
        type: String,
        default: ""
    },

    createdAt: {
        type: Date,
        default: Date.now,
    },

    updatedAt: {
        type: Date,
        default: Date.now
    }
});

EmailLogSchema.index({ campaignId: 1 });
EmailLogSchema.index({ userId: 1 });
EmailLogSchema.index({ createdAt: 1 });  // for daily stats

module.exports = mongoose.model("EmailLog", EmailLogSchema);
