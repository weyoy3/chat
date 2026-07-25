const mongoose = require("mongoose");

const privateMessageSchema = new mongoose.Schema({

    senderId: {

        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        default: null

    },

    receiverId: {

        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        default: null

    },

    senderUsername: {

        type: String,

        required: true,

        trim: true

    },

    receiverUsername: {

        type: String,

        required: true,

        trim: true

    },

    senderAvatar: {

        type: String,

        default: "avatars/default.png"

    },

    type: {

        type: String,

        enum: [

            "text",

            "image",

            "video",

            "voice"

        ],

        default: "text"

    },

    text: {

        type: String,

        default: "",

        trim: true

    },

    file: {

        type: String,

        default: ""

    },

    duration: {

        type: Number,

        default: 0

    },

    delivered: {

        type: Boolean,

        default: false

    },

    seen: {

        type: Boolean,

        default: false

    },

    seenAt: {

        type: Date,

        default: null

    },

    isDeleted: {

        type: Boolean,

        default: false

    },

    deletedBy: {

        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        default: null

    },

    deletedAt: {

        type: Date,

        default: null

    }

}, {

    timestamps: true

});

module.exports = mongoose.model(

    "PrivateMessage",

    privateMessageSchema

);
