const async_hooks = require('async_hooks');
const hook = async_hooks.createHook({
    init(asyncId, type, triggerAsyncId) { }
});
hook.enable();
