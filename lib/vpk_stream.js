var fs = require('fs')
  , events = require('events')
  , util = require('util')
  , CS = require('combined-stream')
  , path = require('path')
  ;

exports.Reader = VPKReader;
function VPKReader(file) {
  var reader = this;
  events.EventEmitter.call(reader);

  var state = 'parse_header';
  var readString = null;

  // file path state
  var currentExt = null;
  var currentPath = null;
  var currentFilename = null;

  // metadata for current file
  var fileMeta = null;

  // header parsing state
  var headerNum = 0;

  var buff = new Buffer(0);
  var offset = 0;
  
  // initialize reader properties
  reader.root = path.dirname(file);
  reader.fileRoot = path.basename(file).replace("_dir.vpk", "");
  reader.metadata = {};
  reader.preloadedFiles = {};
  reader.header = {};

  fs.createReadStream(file).on('readable', function() { p.next(this.read()) })

  var p = parser();
  p.next();

  function* parser() {
    parse: while(state !== 'parse_end') {
      buff = Buffer.concat([buff, yield 1]);
      while(offset < buff.length) {
        if(state === 'parse_directory' || state === 'parse_filename' || state === 'parse_path') {
          // ensure we can read an entire string
          var end = offset;
          while(buff[end] !== 0x00 && end < buff.length) end++;
          if(end === buff.length && buff[end] !== 0x00) continue parse;

          readString = buff.toString('ascii', offset, end);
          offset = end + 1;
        }

        if(state === 'parse_header') {

          // read in 4-byte chunks
          if(buff.length - offset < 4) continue parse;

          if(headerNum === 0 && buff.readUInt32LE(offset) !== 0x55aa1234) {
            throw 'Missing VPK Sigil';
          } else if(headerNum === 1) {
            reader.header.version = buff.readUInt32LE(offset);
          } else if(headerNum === 2) {
            reader.header.treeLength = buff.readUInt32LE(offset);

            if(reader.header.version === 1) {
              state = 'parse_directory';
              reader.emit('header', reader.header);
            }
          } else if(headerNum === 3 || headerNum === 5 || headerNum === 6) {
            reader.header['unknown' + (headerNum - 2)] = buff.readInt32LE(offset);

            if(headerNum === 6) {
              state = 'parse_directory';
              reader.emit('header', reader.header);
            }
          } else if(headerNum === 4) {
            reader.header.footerLength = buff.readUInt32LE(offset);
          }

          headerNum++;
          offset += 4;
        } else if(state === 'parse_directory') {
          currentExt = readString;

          if(currentExt.length === 0) {
            state = 'parse_end';
            reader.emit('directory');
          }
          else state = 'parse_path';
        } else if(state === 'parse_path') {
          currentPath = readString;

          if(currentPath.length === 0) state = 'parse_directory';
          else state = 'parse_filename';
        } else if(state === 'parse_filename') {
          currentFilename = readString;

          if(currentFilename.length === 0) state = 'parse_path';
          else state = 'parse_file_info';
        } else if(state === 'parse_file_info') {
          // wait for whole header
          if(buff.length - offset < 18) continue parse;
          if(buff.readUInt16LE(offset + 16) !== 0xffff) throw new Error('something is very badly wrong with ' + currentFile() + ' at offset ' + offset)
          fileMeta = {};
          fileMeta.CRC = buff.readUInt32LE(offset);
          fileMeta.preloadBytes = buff.readUInt16LE(offset + 4);
          fileMeta.archiveIndex = buff.readUInt16LE(offset + 6);
          fileMeta.entryOffset = buff.readUInt32LE(offset + 8);
          fileMeta.entryLength = buff.readUInt32LE(offset + 12);
          fileMeta.preloaded = false;
          reader.metadata[currentFile()] = fileMeta;

          if(fileMeta.archiveIndex === 0x7fff && fileMeta.entryLength !== 0) {
            throw 'Files after directory not supported';
          }

          if(fileMeta.preloadBytes > 0) {
            state = 'reading_preload_file';

            if(fileMeta.archiveIndex === 0x7fff) fileMeta.preloaded = true;
          } else {
            state = 'parse_filename';
            reader.emit('file', currentFile(), fileMeta);
          }

          offset += 18;
        } else if(state === 'reading_preload_file') {
          // keep reading into buffer until we have all the preload data
          if(buff.length - offset < fileMeta.preloadBytes) continue parse;

          reader.preloadedFiles[currentFile()] = buff.slice(offset, offset + fileMeta.preloadBytes);
          reader.emit('file', currentFile(), fileMeta);

          state = 'parse_filename';
          offset += fileMeta.preloadBytes;
        } else {
          throw 'Unknown state ' + state;
        }
      }
    }
  }

  function currentFile() {
    return currentPath + '/' + currentFilename + '.' + currentExt
  }
}

util.inherits(VPKReader, events.EventEmitter);

VPKReader.prototype.createReadStream = function(file) {
  var meta = this.metadata[file];
  if(!meta) throw 'file not found';

  var preloadContent;

  var fullContents = CS.create();
  if(this.preloadedFiles[file]) fullContents.append(this.preloadedFiles[file]);
  if(!meta.preloaded) {
    var vpkPath = this.root + '/' + this.fileRoot + '_' + ('000' + meta.archiveIndex).slice(-3) + '.vpk';

    var contents = fs.createReadStream(vpkPath, {
      start: meta.entryOffset,
      end: meta.entryOffset + meta.entryLength - 1
    });

    fullContents.append(contents);    
  }
  return fullContents;
}
