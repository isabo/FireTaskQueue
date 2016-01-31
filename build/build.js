var compiler = require('closure-compiler');

var options = {
        js: [
            'src/**.js',
            '!src/**externs.js'
        ],
        env: 'CUSTOM',
        externs: [
            'src/externs.js',
            'node_modules/firebase-externs/firebase-externs.js',
            'node_modules/google-closure-compiler/contrib/nodejs/globals.js'
        ],
        'checks-only': true,
        process_common_js_modules: true,
        common_js_entry_module: 'src/index.js',
        language_in: 'ECMASCRIPT6_STRICT',
        language_out: 'ECMASCRIPT5_STRICT',
        warning_level: 'VERBOSE',
        summary_detail_level: '3'
    };

compiler.compile(undefined, options, function(err, stdout, stderr) {

    console.log(stderr);
});
