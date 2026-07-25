const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({

    username: {

        type: String,

        required: true,

        unique: true,

        trim: true,

        minlength: 3,

        maxlength: 25

    },

    email: {

        type: String,

        required: true,

        unique: true,

        lowercase: true,

        trim: true

    },

    password: {

        type: String,

        required: true

    },

    age: {

        type: Number,

        required: true,

        min: 10,

        max: 100

    },

    gender: {

        type: String,

        enum: [

            "ذكر",

            "أنثى"

        ],

        required: true

    },

    memberType: {

        type: String,

        default: "عضو"

    },
        avatar: {

        type: String,

        default: "avatars/default.png"

    },

    status: {

        type: String,

        enum: [

            "online",

            "offline",

            "away",

            "busy"

        ],

        default: "offline"

    },

    bio: {

        type: String,

        default: "",

        maxlength: 250

    },

    lastSeen: {

        type: Date,

        default: null

    },

    isOnline: {

        type: Boolean,

        default: false

    },

    loginType: {

        type: String,

        enum: [

            "member",

            "guest"

        ],

        default: "member"

    },
        isMuted: {

        type: Boolean,

        default: false

    },

    mutedUntil: {

        type: Date,

        default: null

    },

    isBanned: {

        type: Boolean,

        default: false

    },

    banReason: {

        type: String,

        default: ""

    },

    profileViews: {

        type: Number,

        default: 0

    },

    createdByIP: {

        type: String,

        default: ""

    },

    createdByDevice: {

        type: String,

        default: ""

    }

},
{

    timestamps: true

});

module.exports = mongoose.model(

    "User",

    userSchema

);
