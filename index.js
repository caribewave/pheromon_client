"use strict";

var mqtt = require('mqtt');
var spawn = require('child_process').spawn;
var fs = require('fs');

var PRIVATE = require('./PRIVATE/common.json');
var id = require('./PRIVATE/id.json').id;


// === to set ===
var MEASURE_PERIOD = 5000; // in seconds
var SSH_TIMEOUT = 20 * 1000;
// ===

var sshProcess;
var inited = false;
var events = require('events');
var seismic_sensor = new events.EventEmitter();

seismic_sensor.on('alarm', function(message){
    console.log("sending ", message)
    var payload = JSON.stringify([{
        value: message,
        date: new Date().toISOString()
    }]);
    send('measurement/'+id+'/sismic', payload, {qos: 1});
});

// Debug logger
var DEBUG = process.env.DEBUG || false;
var debug = function() {
    if (DEBUG) {
        [].unshift.call(arguments, '[DEBUG 6brain] ');
        console.log.apply(console, arguments);
    }
};

// mqtt client
var client;

// Restart 6sense processes if the date is in the range.
function startMeasurements(bunching_period) {
        
    var proc = spawn("/home/pi/sensor-pusher/main", ['LIS', '1000', '800', '0']);

    proc.stdout.on('data', function(buffer){
        var parts = buffer.toString().split(" ");
        var data = {x: parseFloat(parts[0]), y: parseFloat(parts[1]), z: parseFloat(parts[2])};
        seismic_sensor.emit("alarm", data);
    });

    proc.on('close', function(code) { 
        console.log("sensor-pusher ended unexpectedily.");
    });

    // seismic_sensor.emit("alarm", {x: Math.random(), y: Math.random(), z: Math.random()});
 
}

function changeDate(newDate) {
    return new Promise(function(resolve, reject) {

        // Change the date
        var child = spawn('date', ['-s', newDate]);

        child.stderr.on('data', function(data) {
            console.log(data.toString());
        });


        child.on('close', function () {
            // Restart all cronjobs
            startJob = createStartJob();
            stopJob = createStopJob();
            if (wifi.recordTrajectories)
                trajJob = createTrajectoryJob();

            restart6senseIfNeeded()
            .then(resolve)
            .catch(reject);
        });
    });
}

// MQTT BLOCK

/*
** Subscribed on :
**  all
**  id
**
** Publish on :
**  init/id
**  status/id/client
**  measurement/id/sismic
**  cmdResult/id
*/

function mqttConnect() {

    client = mqtt.connect('mqtt://' + PRIVATE.host + ':' + PRIVATE.port,
        {
            username: id,
            password: PRIVATE.mqttToken,
            clientId: id,
            keepalive: 10,
            clean: false,
            reconnectPeriod: 1000 * 60 * 1
        }
    );

    client.on('connect', function(){
        console.log('connected to the server. ID :', id);
        client.subscribe('all', {qos: 1});
        client.subscribe(id + '/#', {qos: 1});
        if (!inited) {
            send('init/' + id, '');
            inited = true;
        }
    });

    client.on('offline', function(topic, message) {
        console.log("offline")
    })

    client.on('message', function(topic, buffer) {
        var destination = topic.split('/')[1]; // subtopics[0] is id or all => irrelevant

        var message = buffer.toString();
        console.log("data received :", message, 'destination', destination);

        if (destination) {
            binServer.emit(destination, JSON.parse(message));
        }
        else
            commandHandler(message, send, 'cmdResult/'+id);
    });
}

function send(topic, message, options) {
    if (client)
        client.publish(topic, message, options);
    else {
        debug("mqtt client not ready");
        setTimeout(function() {
            send(topic, message, options);
        }, 10000);
    }
}

function openTunnel(queenPort, antPort, target) {
            
    return new Promise(function(resolve, reject){
        var myProcess = spawn("ssh", ["-v", "-N", "-o", "StrictHostKeyChecking=no", "-R", queenPort + ":localhost:" + antPort, target]);
        debug("nodeprocess :", myProcess.pid, "myProcess: ", process.pid);
        myProcess.stderr.on("data", function(chunkBuffer){
            var message = chunkBuffer.toString();
            debug("ssh stderr => " + message);
            if (message.indexOf("remote forward success") !== -1){
                resolve(myProcess);
            } else if (message.indexOf("Warning: remote port forwarding failed for listen port") !== -1){
                reject({process: myProcess, msg:"Port already in use."});
            }
        });
        // if no error after SSH_TIMEOUT 
        setTimeout(function(){reject({process: myProcess, msg:"SSH timeout"}); }, SSH_TIMEOUT);
    });
}

// COMMAND BLOCK

function commandHandler(fullCommand, sendFunction, topic) { // If a status is sent, his pattern is [command]:[status]

    var commandArgs = fullCommand.split(' ');
    var command = (commandArgs.length >= 1) ? commandArgs[0] : undefined;
    debug('command received : ' + command);
    debug("args :", commandArgs);

    switch(commandArgs.length) {

        case 1:
            // command with no parameter
            switch(command) {
                case 'status':               // Send statuses
                    // send('status/'+id+'/wifi', wifi.state);
                    sendFunction(topic, JSON.stringify({command: command, result: 'OK'}));
                    break;
                case 'reboot':               // Reboot the system
                    sendFunction(topic, JSON.stringify({command: command, result: 'OK'}));
                    setTimeout(function () {
                        spawn('reboot');
                    }, 1000);
                    break;
                case 'resumerecord':         // Start recording
                    // wifi.record(MEASURE_PERIOD);
                    sendFunction(topic, JSON.stringify({command: command, result: 'OK'}));
                    break;
                case 'pauserecord':          // Pause recording
                    // wifi.pause();
                    sendFunction(topic, JSON.stringify({command: command, result: 'OK'}));
                    break;
                case 'closetunnel':          // Close the SSH tunnel
                    if (sshProcess)
                        sshProcess.kill('SIGINT');
                    setTimeout(function () {
                        if (sshProcess)
                            sshProcess.kill();
                    }, 2000);
                    send('cmdResult/'+id, JSON.stringify({command: 'closetunnel', result: 'OK'}));
                    send('status/'+id+'/client', 'connected');
                    break;
            }
            break;

        case 2:
            // command with one parameters
            switch(command) {
                case 'changeperiod':
                    if (commandArgs[1].toString().match(/^\d{1,5}$/)) {
                        MEASURE_PERIOD = parseInt(commandArgs[1], 10);

                        restart6senseIfNeeded()
                        .then(function () {
                            sendFunction(topic, JSON.stringify({command: command, result: commandArgs[1]}));
                        })
                        .catch(function (err) {
                            console.log('Error in restart6senseIfNeeded :', err);
                        });

                    } else {
                        console.log('Period is not an integer ', commandArgs[1]);
                        sendFunction(topic, JSON.stringify({command: command, result: 'KO'}));
                    }
                    break;
                case 'date':                 // Change the sensor's date
                    var date = commandArgs[1].replace('t', ' ').split('.')[0];

                    changeDate()
                    .then(function () {
                        sendFunction(topic, JSON.stringify({command: command, result: date}));
                    })
                    .catch(function (err) {
                        sendFunction(topic, JSON.stringify({command: command, result: err}));
                        console.log('Error in changeDate :', err);
                    });
                    break;
            }
            break;
        case 3:
            switch(command){
                case 'init':                 // Initialize period, start and stop time
                    if (commandArgs[1].match(/^\d{1,5}$/)) {

                        var date = commandArgs[2].replace('t', ' ').split('.')[0];
                        try {
                            spawn('timedatectl', ['set-time', date]);
                        } catch (err) {
                            console.log("Cannot change time :", err)
                        }

                        MEASURE_PERIOD = parseInt(commandArgs[1], 10);
                        startMeasurements(MEASURE_PERIOD);
                        sendFunction(topic, JSON.stringify({command: command, result: 'OK'}));

                    }
                    else {
                        sendFunction(topic, JSON.stringify({command: command, result: 'Error in arguments'}));
                        console.log('error in arguments of init');
                    }
                    break;
            }
            break;

        case 4:
            // command with three parameters
            switch(command) {
                case 'opentunnel':           // Open a reverse SSH tunnel
                    openTunnel(commandArgs[1], commandArgs[2], commandArgs[3])
                    .then(function(process){
                        sshProcess = process;
                        send('cmdResult/'+id, JSON.stringify({command: 'opentunnel', result: 'OK'}));
                        send('status/'+id+'/client', 'tunnelling');
                    })
                    .catch(function(err){
                        console.log(err.msg);
                        console.log("Could not make the tunnel. Cleanning...");
                        send('cmdResult/'+id, JSON.stringify({command: 'opentunnel', result: 'Error : '+err.msg}));
                    });
                    break;
            }

        default:
            console.log('Unrecognized command.', commandArgs);
            break;
    }
}

mqttConnect();

