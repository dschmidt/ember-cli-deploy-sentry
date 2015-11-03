var RSVP = require('rsvp-party').RSVP;


var wait = function(msecs, value) {
    return new Promise(function(resolve, reject) {
        setTimeout(function() {
            resolve(value);
        }, msecs);
    });
};


var promiseMap = function(iterable, body) {
    var tasks = [];
    for(var i=0;i<iterable.length;i++) {
        (function(j) {
            tasks[j] = function() {
                return body(iterable[j]);
            };
        })(i);
    }

    return RSVP.sequence(tasks);
};


promiseMap(['Apple', 'Peach', 'Banana', undefined], function(fruit) {
    console.log('*** FRUIT', fruit);
    return wait(500, {
        type: fruit
    })
}).then(function(result) {
    console.log('RESULT', result);
});

var promiseMapBy = function(iterable, key) {
    return sequence(iterable, function(item) {
        console.log('FOOOOOOO', item);
    });
};



var promises = [
    wait(500, { fruit: 'Apple' }),
    wait(500, { fruit: 'Peach' }),
    wait(500, { fruit: 'Banana' })
];

promiseMapBy(promises, 'fruit').then(function(results) {
    console.log('RESULTS', results);
});
