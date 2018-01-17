const host = 'localhost';
const port = 8765;

const Hapi = require('hapi');

const server = new Hapi.Server({host, port});

server.route({
    method: 'GET',
    path:'/', 
    handler: function (request, h) {
      return h.response('Hello World!');
    }
});

server.start().catch(err => console.log(err));

const autocannon = require('autocannon');

autocannon({
    url: `http://${host}:${port}`,
}, (error, results) => {
  console.log(`hapiserver: ${results.requests.mean} reqs.`);
  process.exit();
})
