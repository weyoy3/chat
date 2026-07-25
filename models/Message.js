const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({

    senderId: {

        type: mongoose.Schema.Types.ObjectId,

        ref: "User",

        default: null

    },

    guestId: {

        type: String,

        default: null

    },

    username: {

        type: String,

        required: true,

        trim: true

    },

    avatar: {

        type: String,

        default: "avatars/default.png"

    },

    memberType: {

        type: String,

        default: "عضو"

    },

    room: {

        type: String,

        default: "general"

    },

    messageType: {

        type: String,

        enum: [

            "text",

            "image",

            "video",

            "voice",

            "system"

        ],

        default: "text"

    },

    text: {

        type: String,

        trim: true,

        default: ""

    },

    file: {

        type: String,

        default: ""

    },

    duration: {

        type: Number,

        default: 0

    },

    isEdited: {

        type: Boolean,

        default: false

    },

    editedAt: {

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

    "Message",

    messageSchema

);
