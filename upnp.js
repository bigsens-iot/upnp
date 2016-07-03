
var url 				= require('url');
var http 				= require('http');
var xml 				= require('xml2js');
var js2xml		 		= require('js2xmlparser');
var _ 					= require('underscore');
var dgram 				= require('dgram'); // dgram is UDP

var LOCATION_KEY 		= 'location';
var knownDevices 		= [];

var KEY_PAIRING_PATH 	= '/udap/api/pairing';
var CMD_PATH 			= '/udap/api/command';

var cmd					= {
	    POWER: 1,
	    NUMBER: {
	        ZERO: 2,
	        ONE: 3,
	        TWO: 4,
	        TREE: 5,
	        FOUR: 6,
	        FIVE: 7,
	        SIX: 8,
	        SEVEN: 9,
	        HEIGHT: 10,
	        NINE: 11
	    },
	    DIRECTION: {
	        UP: 12,
	        DOWN: 13,
	        LEFT: 14,
	        RIGHT: 15
	    },
	    OK: 20,
	    HOME_MENU: 21,
	    MENU_KEY: 22, // same with Home menu key
	    PREVIOUS: 23, // back
	    VOLUME: {
	        UP: 24,
	        DOWN: 25,
	        MUTE: 26
	    },
	    CHANNEL: {
	        UP: 27,
	        DOWN: 28,
	        PREVIOUS: 403, // flash back
	        FAVORITE: 404
	    },
	    COLOR: {
	        BLUE: 29,
	        GREEN: 30,
	        RED: 31,
	        YELLOW: 32
	    },
	    RECORDING: {
	        PLAY: 33,
	        PAUSE: 34,
	        STOP: 35,
	        FAST_FORWARD: 36,
	        REWIND: 37,
	        SKIP_FORWARD: 38,
	        SKIP_BACKWARD: 39,
	        RECORD: 40,
	        LIST: 41
	    },
	    REPEAT: 42,
	    LIVE_TV: 43,
	    EPG: 44,
	    CURRENT_PROG_INFO: 45,
	    ASPECT_RATIO: 46,
	    EXTERNAL_INPUT: 47,
	    SUBTITLE: 49, // Show and change
	    PROG_LIST: 50,
	    TELE_TEXT: 51,
	    MARK: 52,
	    '3D': {
	        VIDEO: 400,
	        LEFT_RIGHT: 401
	    },
	    DASH: 402,
	    QUICK_MENU: 405,
	    TEXT_OPTION: 406,
	    AUDIO_DESCRIPTION: 407,
	    NET_CAST: 408, // same with Home menu
	    ENERGY_SAVING: 409,
	    AV_MODE: 410,
	    SIMPLINK: 411,
	    EXIT: 412,
	    RESERVATION_PROG_LIST: 413,
	    PIP: {
	        SEC_VIDEO: 48,
	        CHANNEL: {
	            UP: 414,
	            DOWN: 415
	        },
	        SWITCH: 416 // Switching between primary/secondary video
	    },
	    MY_APPS: 417
	}

// HTTP

function httpOptions(hostname, port, path, method) {
    return {
        host: hostname,
        port: port,
        path: path,
        method: method,
        headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'User-Agent': 'UDAP/2.0'
        }
    };
}

function sendHttpRequest(options, body, callback) {
    //console.log('HTTP request with options :\n%s', options);

    var req = http.request(options, function(res) {
        res.setEncoding('utf8');

        var responseContent = '';
        res.on('data', function (chunk) {
            responseContent += chunk;
        });

        res.on('end', function() {
        	res.body = responseContent;
        	//if(options.method == 'POST')
        	//	console.log(options);
        	//	console.log('==========RESPONSE==============\nStatus: %s\nBody: \n%s', res.statusCode, res.body);
            callback(null, res);
        });
    });

    req.on('error', function(e) {
    	console.log('==========ERROR==============\nProblem with request: %s', e.message);
        callback(e);
    });

    if (!_.isEmpty(body)) {
        req.write(body);
    }

    req.end();
}


function createSocket() {
	if (parseFloat(process.version.replace(/\w/, ''))>=0.12) {
		return dgram.createSocket({type: 'udp4', reuseAddr: true})
	}

	return dgram.createSocket('udp4')
}

// device

function extractData(data) {
    //debug('===== RESPONSE =====\n%s\n====================', data);

    if (data.indexOf('200 OK') != -1) {
        //debug('Discovery response with success!');
        var regex = /([A-Z,a-z-]+):( )?(.*)/g;
        var match = regex.exec(data);
        var extractedData = [];
        while (match !== null) {
            extractedData[match[1].toLowerCase()] = match[3];
            match = regex.exec(data);
        }

        return extractedData;
    }
    else {
        console.error('An error occured...');
        return null;
    }
}

function buildTvContext(discoveryData) {
    if (discoveryData !== null) {
        var descriptionLocation = discoveryData[LOCATION_KEY];
        if (descriptionLocation !== null) {        
        	var descriptionUrl = url.parse(descriptionLocation);
            return {
                "host": descriptionUrl.host,
                "hostname": descriptionUrl.hostname,
                "port": descriptionUrl.port,
                "descriptionPath": descriptionUrl.path
            };
        }
    }
    return null;
}

function buildDeviceFromDescription(tvContext, json) {
	var device = json.root.device;
	return {
		"name"			: device.modelName,
        "friendlyName"	: device.friendlyName,
        "uuid"			: device.UDN.split(':')[1],
        "type"			: device.deviceType,
		"hostname" 		: tvContext.hostname,
		"port"			: tvContext.port,
		"pairingKey"	: null	
	}
}

function buildKeyPairingOptions(device) {
    return httpOptions(device.hostname, 8080, KEY_PAIRING_PATH, 'POST');
}

function buildCmdOptions(device) {
    return httpOptions(device.hostname, 8080, CMD_PATH, 'POST');
}

function getDevice(uuid) {
    return _.findWhere(knownDevices, {"uuid": uuid});
}

function registerDevice(newDevice) {
    knownDevices = _.reject(knownDevices, function (device) {
        return device.uuid === this.uuid;
    }, { "uuid": newDevice.uuid });
    knownDevices.push(newDevice);
}

function updateDevice(newDevice) {
    var uuid = newDevice.uuid;
    var knownDevice = getDevice(uuid);
    if (!_.isUndefined(knownDevice)) {
        newDevice.pairingKey = knownDevice.pairingKey;
    }
    registerDevice(newDevice);
    return newDevice;
}

function updatePairingKey(device, pairingKey) {
    if (!_.isUndefined(device)) {
        device.pairingKey = pairingKey;
    }
    else {
        console.error("Unable to save pairing key on an undefined device");
    }
}

function getSimpleDevice(device) {
    return {
        "uuid": device.uuid,
        "name": device.name,
        "friendlyName": device.friendlyName,
        "type": device.type,
        "registred": !_.isEmpty(device.pairingKey)
    };
}

/*
<?xml version=\"1.0\" encoding=\"utf-8\"?>" +
		<envelope>
			<api type="pairing">
				<name>hello</name>
				<value>pin</value>
				<port>8080</port>
			</api>
		</envelope>
*/

function lgcmd2xml(type, name, value, port) {
	var json = {api:{'@':{'type':type},'name':name}}
	if(!_.isEmpty(value)) json['value'] = value;
	//if(!_.isEmpty(port)) json['port'] = '8080';
	return js2xml("envelope", json);
}

function sendDisplayKeyPairingRequest(device, callback) {
    if (!_.isNull(device)) {
    	console.log('==========DISPLAY KEY PAIRING==============');   
        var body = lgcmd2xml('pairing', 'showKey')
        console.log(body);
        sendHttpRequest(buildKeyPairingOptions(device), body, callback);
    }
}

function sendStartKeyPairingRequest(device, pin, callback) {
    if (!_.isNull(device)) {
        console.log('==========SEND START KEY PAIRING==============');
        var body = lgcmd2xml('pairing', 'hello', pin);
        console.log(body);
        sendHttpRequest(buildKeyPairingOptions(device), body, callback);
    }
}
/*
function sendEndKeyPairingRequest(device, callback) {
    if (!_.isNull(device)) {
    	console.log('==========SEND END KEY PAIRING==============');
        var body = content.xml('pairing', 'byebye', null, device.port).toString();
        reqManager.send(buildKeyPairingOptions(device), body, callback);
    }
}
*/
function sendCmdRequest(device, cmd, callback) {
    if (!_.isNull(device)) {
    	console.log('==========SEND COMMAND==============');
    	
    	var json = {api:{'@':{'type':'command'},'name':'HandleKeyInput','value':cmd,'port':8080}}
    	var body = js2xml("envelope", json);
        //var body = lgcmd2xml('command', 'HandleKeyInput', cmd, 8080);
        console.log(body);
        var options = buildCmdOptions(device);
        sendHttpRequest(options, body, callback);
    }
}

function discoverDevices(container, callback) {
 
		var finalCallback = _.after(container.length, callback);
    	var devices = [];

        _.each(container, function (discoveredDevice) {
            var tvContext = buildTvContext(discoveredDevice);

            if (!_.isNull(tvContext)) {
	
            	var options = httpOptions(
            		tvContext.hostname,
            		tvContext.port,
            		tvContext.descriptionPath,
            		'GET'
            	)

            	sendHttpRequest(options, null, function (err, res) {
                    if (_.isNull(err)) {
                        
                    	xml.parseString(res.body,
                    		{ explicitArray : false, ignoreAttrs : true },
                    		function (err, result) {
                    			
                    			//console.log(JSON.stringify(result))
                    			
                    			discoveredDevice = buildDeviceFromDescription(tvContext, result);
                    			var updatedDevice = updateDevice(discoveredDevice);
                    			devices.push(getSimpleDevice(updatedDevice));             			
                    		}
                    	);
                    	
                    }

                    finalCallback(devices);
                });
            }
            else {
                finalCallback(devices);
            }
            
       });
}

function hasPairingKey(device) {
    return !_.isEmpty(device.pairingKey);
}

function listRegistredDevices(callback) {
    var registredDevices = _.filter(knownDevices, hasPairingKey);
    if (_.isUndefined(registredDevices)) {
        callback([]);
    }
    else {
        callback(_.map(registredDevices, function (device) {
            return getSimpleDevice(device);
        }));
    }
}

function createStatusResponse(status, device) {
    return {
        "status": status,
        "device": getSimpleDevice(device)
    };
}

function startPairing(uuid, key, callback) {
    var device = getDevice(uuid);
    var keyToSend = !_.isEmpty(key) ? key : device.pairingKey;

    if (!_.isEmpty(keyToSend)) {
        sendStartKeyPairingRequest(device, keyToSend, function (err, res) {
            var status;
            if (_.isNull(err) && res.statusCode == "200") {
                updatePairingKey(device, keyToSend);
                status = 'CONNECTED';
            }
            else {
                status = 'INVALID_PAIRING_KEY';
            }
            callback(err, createStatusResponse(status, device));
        });
    }
    else {
        sendDisplayKeyPairingRequest(device, function (err) {
            callback(err, createStatusResponse('PAIRING_KEY_DISPLAYED', device));
        });
    }
};

function sendCmd(uuid, cmd, callback) {
    var device = getDevice(uuid);
    sendCmdRequest(device, cmd, function (err, res) {
        callback(err, res);
    });
}

// Listen for responses
function listen(port) {
	console.log("port : " + port);
	
	var discoveryContainer = [];
	
	var server = createSocket();

	server.on("message", function (msg, rinfo) {
		//console.log("server got: " + msg + " from " + rinfo.address + ":" + rinfo.port);
		//console.log(rinfo.address + ":" + rinfo.port);
		
		discoveryContainer.push(extractData(msg.toString('utf-8')));

		
	});

	server.bind(port); // Bind to the random port we were given when sending the message, not 1900

	// Give it a while for responses to come in
	setTimeout(function() {
		
		discoverDevices(discoveryContainer, function() {
			
			
			console.log(knownDevices);
			
			/*var uuid = knownDevices[0].uuid;
			
			startPairing(uuid, '214781', function(err, status) {
				console.log(status);
				
				console.log(cmd.VOLUME.UP);
				
				sendCmd(uuid, cmd.VOLUME.UP, function(err, res) {});

				
			});*/
			
			
			//sendDisplayKeyPairingRequest(knownDevices[0], function() {
			//	
			//});
			
		});
		
		console.log("Finished waiting");
		server.close();
	}, 1000);
}

function search() {

	var message = new Buffer(
		"M-SEARCH * HTTP/1.1\r\n" +
		"HOST:239.255.255.250:1900\r\n" + // 239.255.255.250 192.168.0.104
		"ST:ssdp:all\r\n" + // Essential, used by the client to specify what they want to discover, eg 'ST:ge:fridge'
		"MAN:\"ssdp:discover\"\r\n" +
		"MX:1\r\n" + // 1 second to respond (but they all respond immediately?)
		"USER-AGENT:iOS/5.0 UDAP/2.0 iPhone/4\r\n" +
		"\r\n"
	);

	var client = createSocket();
	
	client.on('listening', function onSocketListening() {
	    var addr = client.address();
	    
	    listen(addr.port);
	    
	});
	
	client.bind(0); // So that we get a port so we can listen before sending

	client.send(message, 0, message.length, 1900, "239.255.255.250", function(err, bytes) {
		console.log("ERR: " + err)
		client.close();
	});
}

search();