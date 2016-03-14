'use strict';

var exec = require('child_process').exec;
var path = require('path');
var fs = require('fs');

var privatePath = path.join(__dirname, 'PRIVATE', 'id.json');
var privateJson = {};

try {
    require(privatePath);
}
catch (e){

    exec('ifconfig | grep eth0 | grep -Po "(?<=HWaddr )(.*)"', function (err, stdout) {
        var id;

        if (err) {
            console.log(err);
            process.exit(1);
        }

        id = stdout.toString().trim().replace(/-/g, '').replace(/:/g, '');
        console.log('ID :', id);
        privateJson.id = id;

        fs.writeFile(privatePath, JSON.stringify(privateJson), function (error) {
            if (error) console.log('error in writing id.json:', error);
            
            var hostname = 'ant-' + id;
            exec('cat /etc/hosts | sed s/ant-xxx/' + hostname + '/ > /tmp/hosts.tmp && mv /tmp/hosts.tmp /etc/hosts', function() {
                exec('hostnamectl set-hostname ' + hostname, function () {
                    exec('echo "' + hostname + '" > /etc/hostname', process.exit);
                });
            });
        });
    });
}
