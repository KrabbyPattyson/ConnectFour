
/* Set up static file server */
let static = require('node-static');

/* Set up the http server library */
let http = require('http');

/* Assume that we are running on Heroku */
let port = process.env.PORT;
let directory = __dirname + '/public';

/* If we aren't on Heroku, then port and directory need to be adjusted */
if ((typeof port == 'undefined') || (port === null)) {
    port = 8080;
    directory = './public';
}

/* Set up our static file web server to deliver files from the filesystem */
let file = new static.Server(directory);

let app = http.createServer(
    function (request, response) {
        request.addListener('end',
            function () {
                file.serve(request, response);
            }
        ).resume();
    }
).listen(port);

console.log("The server is running!");


/********************************* */
/*   Set up the web socket server  */

/* Set up a registry of player information and their socket information */
let players = [];

const { Server } = require("socket.io");
const { fail } = require('assert');
const { isArgumentsObject } = require('util/types');
const io = new Server(app);

io.on('connection', (socket) => {

    /* Output a log message on the server and send it to the clients */
    function serverLog(...messages) {
        io.emit('log', ['**** Message from the server:\n']);
        messages.forEach((item) => {
            io.emit('log', ['****\t' + item]);
            console.log(item);
        });
    }

    serverLog('A page connected to the server: ' + socket.id);

    /* join_room command handler */
    /* Expected payload: 
        {
            'room': the room to be joined
            'username': the name of the user joining the room
        }
    */
    /* join_room_response:  
        {
            'result': 'success'
            'room': room that was joined,
            'username': the user that joined the room,
            'count': the number of users in the chat room
            'socket_id': the socket of the user that just joined the room
        }
        or
        {
            'result': 'fail',
            'message': the reason for failure
        }
    */

    socket.on('join_room', (payload) => {
        serverLog('Server received a command', '\'join_room\'', JSON.stringify(payload));
        /* Check that the data coming in is good */
        if ((typeof payload == 'undefined') || (payload === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a payload';
            socket.emit('join_room_response', response);
            serverLog('join_room command failed', JSON.stringify(response));
            return;
        }
        let room = payload.room;
        let username = payload.username;
        if ((typeof room == 'undefined') || (room === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a valid room to join';
            socket.emit('join_room_response', response);
            serverLog('join_room command failed', JSON.stringify(response));
            return;
        }
        if ((typeof username == 'undefined') || (username === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a valid username to join the chat room';
            socket.emit('join_room_response', response);
            serverLog('join_room command failed', JSON.stringify(response));
            return;
        }

        /* Handle the command */
        socket.join(room);

        /* Make sure the client was put in the room */
        io.in(room).fetchSockets().then((sockets) => {
            /* Socket didn't join the room */
            if ((typeof sockets == 'undefined') || (sockets === null) || !sockets.includes(socket)) {
                response = {};
                response.result = 'fail';
                response.message = 'Server internal error joining chat room';
                socket.emit('join_room_response', response);
                serverLog('join_room command failed', JSON.stringify(response));
            }
            /* Socket did join room */
            else {
                players[socket.id] = {
                    username: username,
                    room: room
                }
                /* Announce to everyone that is in the room, who else is in the room */
                for (const member of sockets){
                    let room = players[member.id].room;
                    response = {
                        result: 'success',
                        socket_id: member.id,
                        room: players[member.id].room,
                        username: players[member.id].username,
                        count: sockets.length
                    }
                    /* Tell everyone that a new user has entered the chat room */
                    io.of('/').to(room).emit('join_room_response', response);
                    serverLog('join_room succeeded', JSON.stringify(response));
                    if(room !== "Lobby"){
                        send_game_update(socket, room, 'initial update');
                    }
                }
            }
        });
    });


    socket.on('invite', (payload) => {
        serverLog('Server received a command', '\'invite\'', JSON.stringify(payload));
        /* Check that the data coming in is good */
        if ((typeof payload == 'undefined') || (payload === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a payload';
            socket.emit('invite_response', response);
            serverLog('invite command failed', JSON.stringify(response));
            return;
        }
        let requested_user = payload.requested_user;
        let room = players[socket.id].room;
        let username = players[socket.id].username;
        if ((typeof requested_user == 'undefined') || (requested_user === null) || (requested_user === "")) {
            response = {
                result: 'fail',
                message: 'client did not request a valid user to invite to play'
            };
            socket.emit('invite_response', response);
            serverLog('invite command failed', JSON.stringify(response));
            return;
        }
        if ((typeof room == 'undefined') || (room === null) || (room === "")) {
            response = {
                result: 'fail',
                message: 'the user that was invited is not in the room'
            };
            socket.emit('invite_response', response);
            serverLog('invite command failed', JSON.stringify(response));
            return;
        }
        if ((typeof username == 'undefined') || (username === null) || (username === "")) {
            response = {
                result: 'fail',
                message: 'the user that was invited does not have a name registered'
            };
            socket.emit('invite_response', response);
            serverLog('invite command failed', JSON.stringify(response));
            return;
        }

        /* Make sure the invited player is present */
        io.in(room).allSockets().then((sockets) => {
            /* Invitee isn't in the room */
            if ((typeof sockets == 'undefined') || (sockets === null) || !sockets.has(requested_user)) { /* V14 19:41 */
                response = {
                    result: 'fail',
                    message: 'the user that was invited is no longer in the room'
                };
                socket.emit('invite_response', response);
                serverLog('invite command failed', JSON.stringify(response));
                return;
            }
            /* Invitee is in the room */
            else {
                response = {
                    result: 'success',
                    socket_id: requested_user
                };
                socket.emit("invite_response", response);

                response = {
                    result: 'success',
                    socket_id: socket.id
                };
                socket.to(requested_user).emit("invited", response);
                serverLog('invite command succeeded', JSON.stringify(response));
            }
        });
    });


    socket.on('uninvite', (payload) => {
        serverLog('Server received a command', '\'uninvite\'', JSON.stringify(payload));
        /* Check that the data coming in is good */
        if ((typeof payload == 'undefined') || (payload === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a payload';
            socket.emit('uninvited', response);
            serverLog('unvite command failed', JSON.stringify(response));
            return;
        }
        let requested_user = payload.requested_user;
        let room = players[socket.id].room;
        let username = players[socket.id].username;
        if ((typeof requested_user == 'undefined') || (requested_user === null) || (requested_user === "")) {
            response = {
                result: 'fail',
                message: 'client did not request a valid user to uninvite'
            };
            socket.emit('uninvited', response);
            serverLog('uninvite command failed', JSON.stringify(response));
            return;
        }
        if ((typeof room == 'undefined') || (room === null) || (room === "")) {
            response = {
                result: 'fail',
                message: 'the user that was uninvited is not in the room'
            };
            socket.emit('uninvited', response);
            serverLog('uninvite command failed', JSON.stringify(response));
            return;
        }
        if ((typeof username == 'undefined') || (username === null) || (username === "")) {
            response = {
                result: 'fail',
                message: 'the user that was uninvited does not have a name registered'
            };
            socket.emit('uninvited', response);
            serverLog('uninvite command failed', JSON.stringify(response));
            return;
        }

        /* Make sure the uninvited player is present */
        io.in(room).allSockets().then((sockets) => {
            /* Unvitee isn't in the room */
            if ((typeof sockets == 'undefined') || (sockets === null) || !sockets.has(requested_user)) { /* V14 19:41 */
                response = {
                    result: 'fail',
                    message: 'the user that was uninvited is no longer in the room'
                };
                socket.emit('uninvited', response);
                serverLog('uninvite command failed', JSON.stringify(response));
                return;
            }
            /* Uninvitee is in the room */
            else {
                response = {
                    result: 'success',
                    socket_id: requested_user
                };
                socket.emit("uninvited", response);

                response = {
                    result: 'success',
                    socket_id: socket.id
                };
                socket.to(requested_user).emit("uninvited", response);
                serverLog('uninvite command succeeded', JSON.stringify(response));
            }
        });
    });


    socket.on('game_start', (payload) => {
        serverLog('Server received a command', '\'game_start\'', JSON.stringify(payload));
        /* Check that the data coming in is good */
        if ((typeof payload == 'undefined') || (payload === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a payload';
            socket.emit('game_start_response', response);
            serverLog('game_start command failed', JSON.stringify(response));
            return;
        }
        let requested_user = payload.requested_user;
        let room = players[socket.id].room;
        let username = players[socket.id].username;
        if ((typeof requested_user == 'undefined') || (requested_user === null) || (requested_user === "")) {
            response = {
                result: 'fail',
                message: 'client did not request a valid user to engage in play'
            };
            socket.emit('game_start_response', response);
            serverLog('game_start command failed', JSON.stringify(response));
            return;
        }
        if ((typeof room == 'undefined') || (room === null) || (room === "")) {
            response = {
                result: 'fail',
                message: 'the user that was engaged to play is not in a room'
            };
            socket.emit('game_start_response', response);
            serverLog('game_start command failed', JSON.stringify(response));
            return;
        }
        if ((typeof username == 'undefined') || (username === null) || (username === "")) {
            response = {
                result: 'fail',
                message: 'the user that was engaged to play does not have a registered name'
            };
            socket.emit('game_start_response', response);
            serverLog('game_start command failed', JSON.stringify(response));
            return;
        }

        /* Make sure the player to engage is present */
        io.in(room).allSockets().then((sockets) => {
            /* Engaged player isn't in the room */
            if ((typeof sockets == 'undefined') || (sockets === null) || !sockets.has(requested_user)) { /* V14 19:41 */
                response = {
                    result: 'fail',
                    message: 'the user that was engaged to play is no longer in the room'
                };
                socket.emit('game_start_response', response);
                serverLog('game_start command failed', JSON.stringify(response));
                return;
            }
            /* Engaged player is in the room */
            else {
                let game_id = Math.floor(1 + Math.random() * 0x100000).toString(16);
                response = {
                    result: 'success',
                    game_id: game_id,
                    socket_id: requested_user
                };
                socket.emit("game_start_response", response);
                socket.to(requested_user).emit("game_start_response", response);
            }
        });
    });


    socket.on('disconnect', () => {
        serverLog('A page disconnected from the server: ' + socket.id);
        if((typeof players[socket.id] != 'undefined') && (players[socket.id] != null)){
            let payload = {
                username: players[socket.id].username,
                room: players[socket.id].room,
                count: Object.keys(players).length - 1,
                socket_id: socket.id
            };
            let room = players[socket.id].room;
            delete players[socket.id];
            /* Tell everyone who left the room */
            io.of('/').to(room).emit('player_disconnected', payload);
            serverLog('player_disconnected succeeded ', JSON.stringify(payload));
        }
    });


    /* send_chat_message command handler */
    /* Expected payload: 
        {
            'room': the room that should receive the message
            'username': the name of the user sending the message
            'message': the message to be broadcasted
        }
    */
    /* send_chat_message_response:  
        {
            'result': 'success'
            'username': the user that sent the message,
            'message': the message that was sent
        }
        or
        {
            'result': 'fail',
            'message': the reason for failure
        }
    */

    socket.on('send_chat_message', (payload) => {
        serverLog('Server received a command', '\'send_chat_message\'', JSON.stringify(payload));
        /* Check that the data coming in is good */
        if ((typeof payload == 'undefined') || (payload === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a payload';
            socket.emit('send_chat_message_response', response);
            serverLog('send_chat_message command failed', JSON.stringify(response));
            return;
        }
        let room = payload.room;
        let username = payload.username;
        let message = payload.message;
        if ((typeof room == 'undefined') || (room === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a valid room to message';
            socket.emit('send_chat_message_response', response);
            serverLog('send_chat_message command failed', JSON.stringify(response));
            return;
        }
        if ((typeof username == 'undefined') || (username === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a valid username as a message source';
            socket.emit('send_chat_message_response', response);
            serverLog('send_chat_message command failed', JSON.stringify(response));
            return;
        }
        if ((typeof message == 'undefined') || (message === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a valid message';
            socket.emit('send_chat_message_response', response);
            serverLog('send_chat_message command failed', JSON.stringify(response));
            return;
        }

        /* Handle the command */
        let response = {};
        response.result = 'success';
        response.username = username;
        response.room = room;
        response.message = message;
        /* Tell everyone in the room what the message is */
        io.of('/').to(room).emit('send_chat_message_response', response);
        serverLog('send_chat_message command succeeded', JSON.stringify(response));
    });

    socket.on('play_token', (payload) => {
        serverLog('Server received a command', '\'play_token\'', JSON.stringify(payload));
        /* Check that the data coming in is good */
        if ((typeof payload == 'undefined') || (payload === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'client did not send a payload';
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }

        let player = players[socket.id];
        if ((typeof player == 'undefined') || ([player] === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'play_token came from unregistered player';
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }

        let username = player.username;
        if ((typeof username == 'undefined') || (username === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'play_token command did not come from a registered username';
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }

        let game_id = player.room;
        if ((typeof game_id == 'undefined') || (game_id === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'There was no valid game associated with the play_token';
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }

        let row = payload.row;
        if ((typeof row == 'undefined') || (row === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'There was no valid row associated with the play_token';
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }

        let column = payload.column;
        if ((typeof column == 'undefined') || (column === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'There was no valid column associated with the play_token';
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }

        let color = payload.color;
        if ((typeof color == 'undefined') || (color === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'There was no valid color associated with the play_token';
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }

        let game = games[game_id];
        if ((typeof game == 'undefined') || (game === null)) {
            response = {};
            response.result = 'fail';
            response.message = 'There was no valid game associated with the play_token';
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }

        /* Make sure the current attempt is by the correct color */
        if (color !== game.whose_turn){
            let response = {
                result: 'fail',
                message: 'play_token played the wrong color. It\'s not their turn'
            }
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }

        /* Make sure the current play is by the expected player */

        if ((( game.whose_turn === 'white') && (game.player_white.socket != socket.id)) || 
            (( game.whose_turn === 'black') && (game.player_black.socket != socket.id))){
            let response = {
                result: 'fail',
                message: 'play_token played the right color, but by the wrong player'
            }
            socket.emit('play_token_response', response);
            serverLog('play_token command failed', JSON.stringify(response));
            return;
        }
        

        let response = {
            result: 'success'
        };
        socket.emit('play_token_response', response);

        /* Execute the move 
            Change the selected spot to my_color
            Change the current turn to the other player
        */
        if (color === 'white') {
            game.board[row][column] = 'w';
            //flip_tokens('w', row, column, game.board);
            game.whose_turn = 'black';
            game.legal_moves = calculate_legal_moves('b', game.board)
        }
        else if (color === 'black') {
            game.board[row][column] = 'b';
            //flip_tokens('b', row, column, game.board);
            game.whose_turn = 'white';
            game.legal_moves = calculate_legal_moves('w', game.board)
        }

        /* Announce a move has taken place */
        send_game_update(socket, game_id, ' played a token');

        /* Check if there are any more possible places to place a token*/
        let open_spots = 0;
        for(let r = 0; r < rowLength; r++){
            for(let c = 0; c < columnLength; c++){
                if(game.board[r][c] === ' '){
                    open_spots++;
                }
            }
        }

        /* Check if that was the winning move */
        if(
            check_line(game.board, row, column, 0, 1, color) //Up and down
            || check_line(game.board, row, column, 1, 1, color) //45 degrees
            || check_line(game.board, row, column, 1, 0, color) //Left and right
            || check_line(game.board, row, column, 1, -1, color) //315 degrees
            || open_spots === 0 //No more places to move
        ) {
            let payload = {
                result: 'success',
                game_id: game_id,
                game: games[game_id],
                who_won: open_spots === 0 ? 'Tie game!' : (color + ' won!')
            }
            io.in(game_id).emit('game_over', payload);
            console.log("Game over!");
            /* Delete old games after one hour */
            setTimeout(
                ((id) => {
                    return (() => {
                        delete games[id];
                    });
                })(game_id), 60 * 60 * 1000
            );
        } 
    });
});

function check_line(board, row, column, dirY, dirX, who){
    let correctTokens = 0;
    let correctPos = [];
    for(let shift = 0; shift < 4; shift++){
        for(let i = 0; i < 4; i++){
            let columnPos = (column + (i - shift) * dirX);
            let rowPos = (row + (i - shift) * dirY);
            if( columnPos > 0 &&
                columnPos < columnLength &&
                rowPos > 0 &&
                rowPos < rowLength){
                
                // Check if this is the correct color
                if(board[rowPos][columnPos] === who.substring(0, 1)){
                    correctPos[correctTokens++] = [rowPos, columnPos];
                    if(correctTokens === 4){
                        console.log("Found a four in a row! " + correctPos);
                        return true;
                    }
                } else {
                    // Otherwise, reset
                    correctTokens = 0;
                    break;
                }
            } else {
                // We are outside our boundaries, reset
                correctTokens = 0;
                break;
            }
        }
    }
    return false;
}




/******************************/
/* Code related to game state */

let games = [];
const rowLength = 6;
const columnLength = 7;

function create_new_game(){
    let new_game = {};
    new_game.player_white = {};
    new_game.player_white.socket = "";
    new_game.player_white.username = "";
    new_game.player_black = {};
    new_game.player_black.socket = "";
    new_game.player_black.username = "";

    var d = new Date();
    new_game.last_move_time = d.getTime();

    new_game.whose_turn = 'black';

    new_game.board = [
        [' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' ']
    ];

    new_game.legal_moves = calculate_legal_moves('b', new_game.board);
    return new_game;

}

function calculate_legal_moves(who, board){
    let legal_moves = [
        [' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' '],
        [' ', ' ', ' ', ' ', ' ', ' ', ' ']
    ];

    for(let row = 0; row < rowLength; row++){
        for(let column = 0; column < columnLength; column++) {
            if ((board[row][column] === ' ') && ((row === 5) || (row < rowLength+1 && board[row + 1][column] !== ' '))) {
                legal_moves[row][column] = who;
            }
        }
    }
    console.log(legal_moves);
    return legal_moves;
}

function send_game_update(socket, game_id, message){

    /* Check to see if a game with game_id exists */
    if((typeof games[game_id] == 'undefined') || (games[game_id] === null)){
        console.log("No game exists with game_id:" + game_id + ". Making new game for " + socket.id);
        games[game_id] = create_new_game();
    }

    /* Make sure that only two people are in the room */
    /* Assign this socket a color */
    
    io.of('/').to(game_id).allSockets().then((sockets) => {
        const iterator = sockets[Symbol.iterator]();
        if(sockets.size >= 1) {
            let first = iterator.next().value;
            if((games[game_id].player_white.socket != first) &&
                (games[game_id].player_black.socket != first)){
                /* Player does not have a color */
                if(games[game_id].player_white.socket === "") {
                    /* This player should be white */
                    console.log("White is assigned to: " + first);
                    games[game_id].player_white.socket = first;
                    games[game_id].player_white.username = players[first].username;
                } else if(games[game_id].player_black.socket === ""){
                    /* This player should be black */
                    console.log("Black is assigned to: " + first);
                    games[game_id].player_black.socket = first;
                    games[game_id].player_black.username = players[first].username;
                } else{
                    /* This player should be kicked out */
                    console.log("Kicking out " + first + " from game: " + game_id);
                    io.in(first).socketsLeave([game_id])
                }
            }
        }
        if(sockets.size >= 2) {
            let second = iterator.next().value;
            if((games[game_id].player_white.socket != second) &&
                (games[game_id].player_black.socket != second)){
                /* Player does not have a color */
                if(games[game_id].player_white.socket === "") {
                    /* This player should be white */
                    console.log("White is assigned to: " + second);
                    games[game_id].player_white.socket = second;
                    games[game_id].player_white.username = players[second].username;
                } else if(games[game_id].player_black.socket === ""){
                    /* This player should be black */
                    console.log("Black is assigned to: " + second);
                    games[game_id].player_black.socket = second;
                    games[game_id].player_black.username = players[second].username;
                } else{
                    /* This player should be kicked out */
                    console.log("Kicking out " + second + " from game: " + game_id);
                    io.in(second).socketsLeave([game_id])
                }
            }
        }
        
        /* Send game update */
        let payload = {
            result: 'success',
            game_id: game_id,
            game: games[game_id],
            message: message
        }
        io.of("/").to(game_id).emit('game_update', payload);
    });
}