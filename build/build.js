var compiler = require('closure-compiler');

var options = {
        js: 'src/index.js',
        env: 'CUSTOM',
        externs: [
            'src/externs.js',
            'node_modules/firebase-externs/firebase-externs.js',
            'node_modules/google-closure-compiler/contrib/nodejs/globals.js'
        ],
        'checks-only': true,
        warning_level: 'VERBOSE',
        summary_detail_level: '3'
    };

compiler.compile(undefined, options, function(err, stdout, stderr) {

    console.log(stderr);
});
