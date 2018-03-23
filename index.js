/*jshint esversion: 6 */
/*jslint node: true */
"use strict";

var Client = require('ssh2').Client,
    writer = require('flush-write-stream'),
    nom = require('noms'),
    minimatch = require('minimatch'),
    path = require('path'),
    fs = require('fs'),
    _ = require('lodash');

module.exports = class SFTP {
    constructor({host,user,pass,key, port = '22', agent = 'ssh-dss'} = {}) {
        this.host = host;
        this.user = user;
        this.pass = pass;
        this.port = port;
        this.key = key;
        this.agent = _.isObject(agent) ? agent : {serverHostKey: [agent]};
        this.client;
        this.conn;

        this.credentials = {
          host: this.host,
          username: this.user,
          password: this.pass ? this.pass : null,
          privateKey: this.key ? this.key : null,
          port: this.port,
          algorithms: _.isObject(this.agent) ? this.agent : ''
      };
    }

    /**
     * ==========================================
     * One Time Connections
     * Get or Put file and close connection
     * Returns Promise
     * ==========================================
     */

    get (get,put) {
        const self = this;
        const conn = new Client();
        
        return new Promise(function(resolve,reject) {
            if(!get || !put) return reject('Missing get or put path for sftp.get');
            
            conn.on('ready', function(){
                conn.sftp(function(err,sftp) {
                    if(err) return reject(err);

                    let readStream = sftp.createReadStream(get);
                    let writeStream = fs.createWriteStream(put);

                    writeStream.once('error', function(err){
                        return reject(err);
                    });
                    readStream.once('error', function(err){
                        return reject(err);
                    });

                    writeStream.once('finish', function() {
                        sftp.end();
                        conn.end();
                        resolve({
                            local: get,
                            remote: put
                        });
                    });

                    readStream.pipe(writeStream);
                });
            }).on('error', function(err){
                if(err) return reject(err);
            }).connect(self.credentials);
        });
    }

    put (get,put) {
        const self = this;
        const conn = new Client();

        return new Promise(function(resolve,reject) {
            conn.on('ready', function(){
                conn.sftp(function(err,sftp) {
                    if(err) return reject(err);

                    let readStream = fs.createReadStream(get);
                    let writeStream = sftp.createWriteStream(put);

                    writeStream.once('error', function(err){
                        return reject(err);
                    });
                    readStream.once('error', function(err){
                        return reject(err);
                    });

                    writeStream.once('finish', function() {
                        sftp.end();
                        conn.end();
                        resolve({
                            local: get,
                            remote: put
                        });
                    });

                    readStream.pipe(writeStream);
                });
            }).on('error', function(err){
                if(err) return reject(err);
            }).connect(self.credentials);
        });
    }

    /**
     * ==========================================
     * Continuous Connection
     * Open connection and perform actions
     * must be explicitly closed
     * Returns Promise
     * ==========================================
     */

    open () {
        const self = this;
        self.conn = new Client();

        return new Promise(function(resolve,reject) {
            self.conn.on('ready', function() {
                self.conn.sftp(function(err,sftp) {
                    if(err) return reject(err);
                    self.client = sftp;
                    return resolve(sftp);
                });
            }).on('error', function(err){
                // TODO: this doesn't bubble up correctly and real error isn't shown.
                if(err) return reject(err);
            }).connect(self.credentials);
        });
    }

    start () {
        return this.open();
    }

    close () {
        const self = this;
        return new Promise(function(resolve,reject) {
            self.client.end();
            self.conn.end();
            resolve();
        });
    }

    end () {
        return this.close();
    }

    download (get,put) {
        const self = this;
        if(!put) put = './tmp/' + path.basename(get);
        return new Promise(function(resolve,reject) {
            let readStream = self.client.createReadStream(get);
            let writeStream = fs.createWriteStream(put);

            writeStream.once('error', function(err){
                return reject(err);
            });
            readStream.once('error', function(err){
                return reject(err);
            });

            writeStream.on('finish', function() {
                resolve({
                    local: get,
                    remote: put
                });
            });

            readStream.pipe(writeStream);
        });
    }

    upload (get,put) {
        const self = this;
        if(!put) {
            put = get;
            get = './tmp/' + path.basename(put);
        }

        return new Promise(function(resolve,reject) {
            let readStream = fs.createReadStream(get);
            let writeStream = self.client.createWriteStream(put);

            writeStream.once('error', function(err){
                return reject(err);
            });
            readStream.once('error', function(err){
                return reject(err);
            });

            writeStream.once('finish', function() {
                resolve({
                    local: get,
                    remote: put
                });
            });

            readStream.pipe(writeStream);
        });
    }

    copy (get,put) {
        const self = this;
        return new Promise(function(resolve,reject) {
            if(!get) return reject(new Error('.upload() parameter "get" is "'+  get +'" which is missing or incorrect'));
            if(!put) return reject(new Error('.upload() parameter "put" is "'+  put +'" which is missing or incorrect'));

            let readStream = self.client.createReadStream(get);
            let writeStream = self.client.createWriteStream(put);

            writeStream.once('error', function(err){
                return reject(err);
            });
            readStream.once('error', function(err){
                return reject(err);
            });

            writeStream.once('finish', function() {
                resolve({
                    get: get,
                    put: put
                });
            });

            readStream.pipe(writeStream);
        });
    }

    move (get,put) {
        const self = this;
        return new Promise(function(resolve,reject) {
            if(!get) return reject(new Error('.move() parameter "get" is "'+  get +'" which is missing or incorrect'));
            if(!put) return reject(new Error('.move() parameter "put" is "'+  put +'" which is missing or incorrect'));

            let readStream = self.client.createReadStream(get);
            let writeStream = self.client.createWriteStream(put);

            writeStream.once('error', function(err){
                return reject(err);
            });
            readStream.once('error', function(err){
                return reject(err);
            });

            writeStream.once('finish', function() {

                self.client.unlink(get, function(err){
                    if(err) return reject(err);
                    resolve({
                        get: get,
                        put: put
                    });
                });
            });

            readStream.pipe(writeStream);
        });
    }

    rename(oldName,newName,path = '/') {
        const self = this;
        return new Promise(function(resolve,reject){
            if(!oldName & !newName) return reject(new Error('Missing renaming parameter oldName or newName'));
            self.client.unlink(path + newName, function(err){
              self.client.rename(path + oldName, path + newName, function(err){
                  if(err) return reject(err);
                  resolve(newName);
              });
            });

        });
    }

    create(path) {
        const self = this;
        return new Promise(function(resolve,reject){
            if(!path) return reject(new Error('.exists() parameter "path" is missing'));
            self.client.open(path, 'w', function(err, fd) {
                if(err) return reject(err);
                self.client.close(fd, function(err){
                    if(err) return reject(err);
                    resolve(path);
                });
            });
        });
    }
    
    delete(path) {
        const self = this;
        return new Promise(function(resolve,reject){
            if(!path) return reject(new Error('.delete() parameter "path" is missing'));
            self.client.unlink(path, function(err) {
                if(err) return reject(err);
                resolve();
            });
        });
    }

    exists(path) {
        const self = this;
        return new Promise(function(resolve,reject) {
            if(!path) return reject(new Error('.exists() parameter "path" is missing'));
            self.client.stat(path,function(err,stat){
                if(err && !stat) {
                    return reject(new Error('SFTP Error: Cannot find file'));
                }
                resolve(path);
            });
        });
    }

    directory(path) {
        const self = this;
        return new Promise(function(resolve,reject) {
            if(!path) path = '/';
            self.client.readdir(path,function(err,files){
                if(err) return reject(new Error('SFTP Error: Cannot read directory', err));

                resolve(files);
            });
        });
    }

    findFile(path, filename) {
        const self = this;
        return new Promise(function(resolve,reject){
            if(!filename) {
                let filename = path;
                path = '/';
            }
            if(!path && !filename) return reject(new Error('.findFile() parameter "filename" is missing'));

            self.directory(path)
            .then(function(files){
                let matches = [],
                    result = null;

                files.forEach(function(file){
                    if(minimatch(file.filename, filename)) matches.push(file);
                });

                if(!matches.length) return reject();
                result = _.maxBy(matches,function(f){
                    return f.attrs.mtime;
                });

                if(!result) return reject();
                resolve(result.filename);

            }).catch(function(err){
                console.log('dir err', err);
            });
        });
    }

    findFiles(path, filename) {
        const self = this;
        return new Promise(function(resolve,reject){
            if(!filename) {
                let filename = path;
                path = '/';
            }
            if(!path && !filename) return reject(new Error('.findFiles() parameter "filename" is missing'));

            self.directory(path)
            .then(function(files){
                let matches = [];
                files.forEach(function(file){
                    if(minimatch(file.filename, filename)) matches.push(file.filename);
                });
                if(!matches.length) return reject();
                resolve(matches);
            }).catch(reject);
        });
    }


    /**
     * ==========================================
     * Stream Methods
     * Read or write data as a stream
     * Returns Stream
     * ==========================================
     */

    getStream (get) {
        const self = this;
        const conn = new Client();

        let client,
            fileData,
            buffer,
            totalBytes = 0,
            bytesRead = 0;

        let read = function(size,next) {
            const read = this;

            // Check if we're done reading
            if(bytesRead === totalBytes) {
                client.close(fileData);
                client.end();
                conn.end();
                return read.push(null);
            }

            // Make sure we read the last bit of the file
            if ((bytesRead + size) > totalBytes) {
                size = (totalBytes - bytesRead);
            }

            // Read each chunk of the file
            client.read(fileData, buffer, bytesRead, size, bytesRead,
                function (err, byteCount, buff, pos) {
                    if(err) next(new Error('SFTP Error reading data:\n ' + err));
                    bytesRead += byteCount;
                    read.push(buff);
                    next();
                }
            );
        };

        let before = function(start) {
            // setup the connection BEFORE we start _read
            conn.on('ready', function(){
                conn.sftp(function(err,sftp) {
                    if(err) return start(new Error('Error creating SFTP client:\n ' + err));
                    sftp.open(get, 'r', function(err, fd){
                        if(err) return start(new Error('SFTP Error opening file to read:\n ' + err));
                        sftp.fstat(fd, function(err, stats) {
                            if(err) return start(new Error('SFTP Error getting file stats:\n ' + err));
                            client = sftp;
                            fileData = fd;
                            totalBytes = stats.size;
                            buffer = new Buffer(totalBytes);

                            start();
                        });
                    });
                });
            }).on('error', function(err){
                if(err) return start(new Error('Error connecting to SFTP:\n ' + err));
            }).connect(self.credentials);
        };

        return nom({highWaterMark: 32*1024},read,before);

    }


    putStream (put) {
        const self = this;
        const conn = new Client();

        let isConnected = false,
            client,
            file,
            bytesWritten = 0,
            keepwriting = true;

        let write = function(chunk,enc,next) {
            if(!isConnected) {
                conn.on('ready', function(){
                    conn.sftp(function(err,sftp) {
                        if(err) next(new Error('Error creating SFTP client:\n ' + err));
                        sftp.open(put + '_writing', 'w+', function(err, fd){
                            if(err) return next(new Error('SFTP Error opening file to write:\n ' + err));
                            client = sftp;
                            file = fd;
                            isConnected = true;

                            client.write(file, chunk, 0, chunk.length, bytesWritten,
                                function(err) {
                                    if(err) return next(new Error('Error writing to SFTP:\n ' + err));
                                    bytesWritten += chunk.length;
                                    next();
                                }
                            );
                        });
                    });
                }).on('error', function(err){
                    if(err) return next(new Error('Error connecting to SFTP:\n ' + err));
                }).connect(self.credentials);
            } else {
                client.write(file, chunk, 0, chunk.length, bytesWritten,
                    function(err) {
                        if(err) return next(new Error('Error writing to SFTP:\n ' + err));
                        bytesWritten += chunk.length;
                        next();
                    }
                );
            }
        };

        let flush = function(done) {
            // Done writing, close file
            client.close(file,function(){
                // Unlink the target file if it already exists
                client.unlink(put, function(err) {
                    // Rename temp writing file to target file name
                    client.rename(put + '_writing', put, function(err){
                        client.end();
                        conn.end();
                        if(err) return done(new Error('SFTP Error renaming file:\n ' + err));
                        done();
                    });
                });
            });            
        };

        return writer({highWaterMark: 32*1024},write,flush);
    }
};