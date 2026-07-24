
const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({

    senderId:{

        type:mongoose.Schema.Types.ObjectId,

        ref:"User",

        required:true

    },

    username:{

        type:String,

        required:true

    },

    avatar:{

        type:String,

        default:"avatars/default.png"

    },

    memberType:{

        type:String,

        default:"عضو"

    },

    text:{

        type:String,

        required:true,

        trim:true,

        maxlength:5000

    },

    room:{

        type:String,

        default:"general"

    },

    messageType:{

        type:String,

        enum:[

            "text",

            "system"

        ],

        default:"text"

    },

    isEdited:{

        type:Boolean,

        default:false

    },

    editedAt:{

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

    "Message",

    messageSchema

);
