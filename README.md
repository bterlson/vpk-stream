## VPK (Valve Pak) file parser
Provides streams for files contained inside a VPK.

Note: Requires support for generators (pass --harmony to Node >= 0.11).

### Usage
```js
var VPKReader = require('VPKReader');
var path = require('path');

var reader = new VPKReader('path/to/vpk_dir.vpk');

reader.on('file', function(filename, metadata) {
  // Called for each file discovered in the VPK
  // Metadata information about how the file was stored in the VPK

  if(file.match(/\.txt$/)) {
    // Get a read stream to any file already discovered in the vpk.
    reader.createReadStream(filename)
    .pipe(fs.createWriteStream(path.basename(filename)))
  }

  
});

reader.on('directory', function() {
  // called once when the directory has been completely loaded.
  // Can now call createReadStream for any file in the vpk.
});
```

