const util = require('util')

var global = {};

var lifter = util.promisify;

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
  var blob = global.blobManager.create(global.account);
  var tx = global.db.begin();
  var blobIdP = blob.put(stream);
  var fileP = global.self.byUuidOrPath(idOrPath).get();
  var version, fileId, file;

  Promise.all([blobIdP, fileP]).then(function(result) {
    var blobId = result[0];
    var fileV = result[1];
    file = fileV;
    var previousId = file ? file.version : null;
    version = {
      userAccountId: global.userAccount.id,
      date: new Date(),
      blobId: blobId,
      creatorId: global.userAccount.id,
      previousId: previousId,
    };
    version.id = global.Version.createHash(version);
    return global.Version.insert(version).execWithin(tx);
  }).then(function() {
    if (!file) {
      var splitPath = idOrPath.split('/');
      var fileName = splitPath[splitPath.length - 1];
      var newId = global.uuid.v1();
      return global.self.createQuery(idOrPath, {
        id: newId,
        userAccountId: global.userAccount.id,
        name: fileName,
        version: version.id
      }).then(function(q) {
        return q.execWithin(tx);
      }).then(function() {
        return newId;
      });
    } else {
      return file.id;
    }
  }).then(function(fileIdV) {
    fileId = fileIdV;
    return global.FileVersion.insert({
      fileId: fileId,
      versionId: version.id
    }).execWithin(tx);
  }).then(function() {
    return global.File.whereUpdate({id: fileId}, {version: version.id})
        .execWithin(tx);
  }).then(function() {
    tx.commit();
    return done();
  }, function(err) {
    tx.rollback();
    return done(err);
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
      console.log(`Bluebird-doxbee (regular): ${Date.now() - start} ms.`);
    }
  }
}

fakemaker(dummyP, lifter);
perf();
