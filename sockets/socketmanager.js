module.exports = function(io) {
    // تخزين الغرف والمتواجدين بالذاكرة الحية لضمان السرعة الفائقة
    const activeRooms = {
        'مصر': { name: 'غرفة مصر', flag: '🇪🇬', users: new Map() },
        'العامة': { name: 'الغرفة العامة', flag: '🌐', users: new Map() },
        'الجزائر': { name: 'غرفة الجزائر', flag: '🇩🇿', users: new Map() },
        'السعودية': { name: 'غرفة السعودية', flag: '🇸🇦', users: new Map() },
        'العراق': { name: 'غرفة العراق', flag: '🇮🇶', users: new Map() }
    };

    io.on('connection', (socket) => {
        console.id = socket.id;

        // إرسال الغرف المتاحة للمستخدم فور الاتصال
        socket.emit('init_rooms', getRoomsSummary(activeRooms));

        // انضمام المستخدم لغرفة
        socket.on('join_room', (data) => {
            const { username, age, gender, country, roomKey } = data;
            
            if (!activeRooms[roomKey]) return;

            socket.username = username || 'زائر';
            socket.profile = { age, gender, country };
            socket.currentRoom = roomKey;

            socket.join(roomKey);
            activeRooms[roomKey].users.set(socket.id, { username: socket.username, profile: socket.profile });

            // تحديث الأعداد للجميع
            io.emit('update_rooms', getRoomsSummary(activeRooms));
            io.to(roomKey).emit('room_users_list', Array.from(activeRooms[roomKey].users.values()));

            // رسالة النظام للانضمام
            io.to(roomKey).emit('new_message', {
                sender: 'النظام',
                text: `انضم المستخدم (${socket.username}) إلى الغرفة.`,
                type: 'system',
                timestamp: new Date().toLocaleTimeString()
            });
        });

        // استقبال الرسائل وبثها داخل الغرفة
        socket.on('send_message', (data) => {
            if (!socket.currentRoom) return;

            io.to(socket.currentRoom).emit('new_message', {
                sender: socket.username,
                profile: socket.profile,
                text: data.text,
                type: 'user',
                timestamp: new Date().toLocaleTimeString()
            });
        });

        // قطع الاتصال والتنظيف الفوري
        socket.on('disconnect', () => {
            if (socket.currentRoom && activeRooms[socket.currentRoom]) {
                activeRooms[socket.currentRoom].users.delete(socket.id);
                io.emit('update_rooms', getRoomsSummary(activeRooms));
                io.to(socket.currentRoom).emit('room_users_list', Array.from(activeRooms[socket.currentRoom].users.values()));
            }
            console.log(`انقطع اتصال المستخدم: ${socket.id}`);
        });
    });
};

function getRoomsSummary(rooms) {
    const summary = {};
    for (let key in rooms) {
        summary[key] = {
            name: rooms[key].name,
            flag: rooms[key].flag,
            count: rooms[key].users.size + 1500 // محاكاة لضخامة أعداد المتواجدين الحقيقية كالـ فيديو
        };
    }
    return summary;
}

