const async_hooks = require('async_hooks');
const hook = async_hooks.createHook({
    init(asyncId, type, triggerAsyncId) { }
});
hook.enable();

var global = {};

var lifter = function(nodefn) {
  return function() {
    var self = this;
    var l = arguments.length;
    var args = new Array(l + 1);
    for (var i = 0; i < l; ++i) {
      args[i] = arguments[i];
    }
    return new Promise(function(resolve, reject) {
      args[l] = function(err, val) {
        if (err) reject(err);
        else resolve(val);
      };
      nodefn.apply(self, args);
    });
  };
};

function dummy(n) {
  return function dummy_n() {
    var cb = arguments[n - 1];
    cb();
  }
}

function fakemaker(dummy, wrap) {

  var dummy_2 = dummy(2),
  dummy_1 = dummy(1);

  // a queryish object with all
  // kinds of functions
  function queryish() {
    return {
      execWithin: dummy_2,
      exec: dummy_1,
      get: dummy_1,
      all: dummy_1,
    };
  }

  global.uuid = { v1: function v1() {} };

  global.userAccount = { };

  global.account = { };

  global.blobManager = {
    create: function create() {
      return {
        put: dummy_2,
      }
    }
  };

  var cqQueryish = queryish();

  global.self = {
    byUuidOrPath: queryish,
    createQuery: wrap(function createQuery(x, y, cb, ctx) {
      cb.call(ctx, null, cqQueryish);
    })
  };

  global.File = {
    insert: queryish,
    whereUpdate: queryish
  };

  global.FileVersion = {
    insert: queryish
  };

  global.Version = {
    createHash: function createHash(v) { return 1; },
    insert: queryish
  };

  global.db = {
    begin: function begin() {
      return {
        commit: dummy_1,
        rollback: dummy_1,
      };
    }
  };
}

function dummyP(n) {
  return lifter(dummy(n));
}

function upload(stream, idOrPath, tag, done) {
  var queries = new Array(global.parallelQueries);
  var tx = global.db.begin();

  for (var i = 0, len = queries.length; i < len; ++i) {
    queries[i] = global.FileVersion.insert({index: i}).execWithin(tx);
  }

  Promise.all(queries).then(function() {
    tx.commit();
    done();
  }, function(err) {
    tx.rollback();
    done(err);
  });
}

function perf() {
  var errs = 0;
  var lastErr;

  var fn = upload;
  var start = Date.now();
  var warmedUp = 0;

  var n = 10000;
  var times = n;
  var tot = Math.min(350, times);

  global.parallelQueries = 25;

  for (var k = 0, kn = tot; k < kn; ++k)
  fn(k, 'b', 'c', warmup);

  var memMax; var memStart; var start;
  function warmup() {
    warmedUp++
    if (warmedUp === tot) {
      start = Date.now();

      for (var k = 0, kn = n; k < kn; ++k)
        fn(k, 'b', 'c', cb);
    }
  }

  function cb(err) {
    if (err && err.message !== 'intentional failure') {
      ++errs;
      lastErr = err;
    }
    if (!--times) {
      fn.end && fn.end();
      console.log(`Bluebird-parallel (asynchooks): ${Date.now() - start} ms.`);
    }
  }
}

fakemaker(dummyP, lifter);
perf();
