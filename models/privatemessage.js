const mongoose = require("mongoose");

const privateMessageSchema = new mongoose.Schema({

    senderId:{

        type:mongoose.Schema.Types.ObjectId,

        ref:"User",

        required:true

    },

    receiverId:{

        type:mongoose.Schema.Types.ObjectId,

        ref:"User",

        required:true

    },

    senderUsername:{

        type:String,

        required:true

    },

    receiverUsername:{

        type:String,

        required:true

    },

    senderAvatar:{

        type:String,

        default:"avatars/default.png"

    },

    type:{

        type:String,

        enum:[

            "text",

            "image",

            "video",

            "voice"

        ],

        default:"text"

    },

    text:{

        type:String,

        default:""

    },

    file:{

        type:String,

        default:""

    },

    duration:{

        type:Number,

        default:0

    },
  
    delivered:{

        type:Boolean,

        default:false

    },

    seen:{

        type:Boolean,

        default:false

    },

    seenAt:{

        type:Date,

        default:null

    },

    isDeleted:{

        type:Boolean,

        default:false

    },

    deletedBy:{

        type:mongoose.Schema.Types.ObjectId,

        ref:"User",

        default:null

    },

    deletedAt:{

        type:Date,

        default:null

    }

},
{

    timestamps:true

});

module.exports = mongoose.model(

    "PrivateMessage",

    privateMessageSchema

);
