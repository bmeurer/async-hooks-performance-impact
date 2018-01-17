# Performance impact of async_hooks

 - https://github.com/nodejs/diagnostics/issues/124
 - https://github.com/nodejs/benchmarking/issues/188

This is a simple demo of the potential performance impact of `async_hooks`
on Promise heavy workloads. This repository contains the popular
[Bluebird](https://github.com/petkaantonov/bluebird) benchmarks and the
so-called *Wikipedia Promise* benchmark with and
without `async_hooks` (running with native promises).

To measure the actual impact there's a version of each benchmark with
an empty `init` hook, i.e. we prepend the following code to the actual
code under test:

```js
const async_hooks = require('async_hooks');
const hook = async_hooks.createHook({
    init(asyncId, type, triggerAsyncId) { }
});
hook.enable();
```


## Results

Here the results of running the Promise micro benchmarks with and without
`async_hooks` enabled:

| Benchmark                      | Node 8.4.0 | Node 9.3.0 |
| ------------------------------:| ----------:| ----------:|
| Bluebird-doxbee (asynchooks)   |     458 ms |     369 ms |
| Bluebird-doxbee (regular)      |     301 ms |     179 ms |
| Bluebird-parallel (asynchooks) |    1310 ms |    1079 ms |
| Bluebird-parallel (regular)    |     839 ms |     671 ms |
| Wikipedia (asynchooks)         |    1656 ms |    1790 ms |
| Wikipedia (regular)            |     930 ms |     863 ms |

![Results for Node 9.3.0](https://raw.githubusercontent.com/bmeurer/async-hooks-performance-impact/master/results-node-9.3.0.png)

And we also ran some more realistic benchmarks, based on `hapi` and
`koa`, with and without `async_hooks` enabled:

| Benchmark         | Node 9.4.0    |
| ----------------: | ------------: |
| hapi (asynchooks) | 6026.9 reqs   |
| hapi (regular)    | 9024.19 reqs  |
| koa (asynchooks)  | 11508.6 reqs  |
| koa (regular)     | 12592.55 reqs |

The `koa` benchmark is pretty flaky, so the performance difference could be
within noise and thus not relevant.

![Results for Node 9.4.0](https://raw.githubusercontent.com/bmeurer/async-hooks-performance-impact/master/results-hapi-koa-node-9.4.0.png)

## Bluebird benchmarks

The files here are modified from: [https://github.com/petkaantonov/bluebird/tree/master/benchmark](https://github.com/petkaantonov/bluebird/tree/master/benchmark)

The current version is based on `bluebird@c0d4472cecd523c2f9d4805a23d87be3cfe03b41`


## Wikipedia Benchmark

The files here are modified from: [https://github.com/wikimedia/web-stream-util](https://github.com/wikimedia/web-stream-util)

The current version is based on `web-stream-util@fc76740cd6a73dcb044251a233bc3c868d3c9a77`
