"use strict";

var mqtt = require('mqtt');
var spawn = require('child_process').spawn;
var fs = require('fs');

var PRIVATE = require('./PRIVATE/common.json');


function mqttConnect(id) {

    var client = mqtt.connect('mqtt://' + PRIVATE.host + ':' + PRIVATE.port,
        {
            username: "pheroman",
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
        client.publish('init/' + id, '');
    });

    client.on('offline', function(topic, message) {
        console.log("offline")
    })

    client.on('message', function(topic, buffer) {
        var destination = topic.split('/')[1]; // subtopics[0] is id or all => irrelevant

        var message = buffer.toString();
        console.log("data received :", message, 'destination', destination);

    });

    return client;
}

function sendFake(client, id) {
    var message = {x: Math.random(), 
        y: Math.random(), 
        z: Math.random(),
        dt: new Date().toISOString()
    };
    var payload = JSON.stringify([{
        value: message,
        date: new Date().toISOString()
    }])
    client.publish('measurement/'+id+'/sismic', payload, {qos: 1})
}



var test1 = mqttConnect("test1");
var test2 = mqttConnect("test2");
var test3 = mqttConnect("test3");
var test4 = mqttConnect("test4");
var test5 = mqttConnect("test5");

setTimeout(function(){
    sendFake(test1, "test1");
}, 2000)

setTimeout(function(){
    sendFake(test2, "test2");
}, 7000)

setTimeout(function(){
    sendFake(test3, "test3");
}, 13000)

setTimeout(function(){
    sendFake(test4, "test4");
}, 18000)

setTimeout(function(){
    sendFake(test5, "test5");
}, 21000)

