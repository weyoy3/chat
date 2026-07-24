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

        lowercase: true

    },

    password: {

        type: String,

        required: true

    },

    age: {

        type: Number,

        required: true

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

        default:
        "avatars/default.png"

    },

    status: {

        type: String,

        default: "offline"

    },

    bio: {

        type: String,

        default: ""

    }

},
{

    timestamps:true

});
    ,

    lastSeen: {

        type: Date,

        default: null

    },

    isOnline: {

        type: Boolean,

        default: false

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

    loginType: {

        type: String,

        enum: [

            "member",

            "guest"

        ],

        default: "member"

    },

    profileViews: {

        type: Number,

        default: 0

    }

},
{

    timestamps: true

});

module.exports = mongoose.model(

    "User",

    userSchema

);
