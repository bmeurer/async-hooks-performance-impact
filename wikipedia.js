(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

// Helper to make returns monomorphic.
function readerReturn(value, done) {
    return {
        value: value,
        done: done,
    };
}

/**
 * ReadableStream wrapping an array.
 *
 * @param {Array} arr, the array to wrap into a stream.
 * @return {ReadableStream}
 */
function arrayToStream(arr) {
    return new ReadableStream({
        start(controller) {
            for (var i = 0; i < arr.length; i++) {
                controller.enqueue(arr[i]);
            }
            controller.close();
        }
    });
}

class ArrayReader {
    constructor(arr) {
        this._arr = arr;
        this._index = 0;
    }
    read() {
        if (this._index < this._arr.length) {
            return Promise.resolve(readerReturn(this._arr[this._index++], false));
        } else {
            return Promise.resolve(readerReturn(undefined, true));
        }
    }
    cancel() {
        this._offset = -1;
    }
}

/**
 * Chunk evaluation transform:
 * - functions are called with ctx parameter,
 * - Promises are resolved to a value,
 * - ReadableStreams are spliced into the main string, and
 * - all other types are passed through unchanged.
 *
 * @param {object} ctx, a context object passed to function chunks.
 * @return {function(Reader) -> Reader}
 */
class FlatStreamReader {
    constructor(input, ctx) {
        this._reader = toReader(input);
        this._ctx = ctx;
        this._subStreamReaderStack = [];
    }

    _handleReadRes(res) {
        if (res.done) {
            return res;
        }

        let chunk = res.value;
        // Fast path
        if (typeof chunk === 'string') {
            return res;
        }
        if (typeof chunk === 'function') {
            chunk = chunk(this._ctx);
        }
        if (chunk) {
            if (Array.isArray(chunk)) {
                this._subStreamReaderStack.push(new ArrayReader(chunk));
                return this.read();
            }
            if (typeof chunk.then === 'function') {
                // Looks like a Promise.
                return chunk.then(val => {
                    res.value = val;
                    return this._handleReadRes(res);
                });
            }
            if (typeof chunk.read === 'function') {
                // Reader.
                this._subStreamReaderStack.push(chunk);
                return this.read();
            }
            if (typeof chunk.getReader === 'function') {
                // ReadableStream.
                this._subStreamReaderStack.push(chunk.getReader());
                return this.read();
            }
        }
        res.value = chunk;
        return res;
    }

    read() {
        if (this._subStreamReaderStack.length) {
            return this._subStreamReaderStack[this._subStreamReaderStack.length - 1].read()
            .then(res => {
                if (res.done) {
                    this._subStreamReaderStack.pop();
                    return this.read();
                }
                return this._handleReadRes(res);
            });
        } else {
            return this._reader.read().then(res => this._handleReadRes(res));
        }
    }

    cancel(reason) {
        if (this._subStreamReaderStack.length) {
            this._subStreamReaderStack.map(reader => reader.cancel(reason));
        }
        return this._reader.cancel && this._reader.cancel(reason);
    }
}

/**
 * Adapt a Reader to an UnderlyingSource, for wrapping into a ReadableStream.
 *
 * @param {Reader} reader
 * @return {ReadableStream}
 */
function readerToStream(reader) {
    return new ReadableStream({
        pull(controller) {
            return reader.read()
                .then(res => {
                    if (res.done) {
                        controller.close();
                    } else {
                        controller.enqueue(res.value);
                    }
                });
        },
        cancel(reason) { return reader.cancel(reason); }
    });
}

function toReader(s) {
    if (s) {
        if (typeof s.read === 'function') {
            // Looks like a Reader.
            return s;
        }
        if (typeof s.getReader === 'function') {
            // ReadableStream
            return s.getReader();
        }
        if (Array.isArray(s)) {
            return new ArrayReader(s);
        }
    }
    return new ArrayReader([s]);
}

function toStream(s) {
    if (s) {
        if (typeof s.getReader === 'function') {
            // Already a ReadableStream
            return s;
        }
        if (Array.isArray(s)) {
            return arrayToStream(s);
        }
        if (typeof s.read === 'function') {
            // Reader
            return readerToStream(s);
        }
    }
    return arrayToStream([s]);
}

function readToArray(s) {
    const reader = toReader(s);
    const accum = [];
    function pump() {
        return reader.read()
        .then(res => {
            if (res.done) {
                return accum;
            }
            accum.push(res.value);
            return pump();
        });
    }
    return pump();
}

function readToString(s) {
    const reader = toReader(s);
    const decoder = new TextDecoder();
    let accum = '';
    function pump() {
        return reader.read()
        .then(res => {
            if (res.done) {
                // TODO: check decoder for completeness.
                return accum;
            }
            if (typeof res.value === 'string') {
                accum += res.value;
            } else {
                accum += decoder.decode(res.value, { stream: true });
            }
            return pump();
        });
    }
    return pump();
}

class TextDecodeReader {
    constructor(reader) {
        this._reader = toReader(reader);
        this._decoder = new TextDecoder();
    }

    read() {
        return this._reader.read()
        .then(res => {
            if (res.done) {
                // TODO: Throw error if the decoder still holds onto some
                // undecoded bytes!
                return res;
            }
            res.value = this._decoder.decode(res.value, { stream: true });
            return res;
        });
    }
    cancel(reason) {
        this._reader.cancel(reason);
    }
}

class TextEncodeReader {
    constructor(reader) {
        this._reader = toReader(reader);
        this._encoder = new TextEncoder();
    }

    read() {
        return this._reader.read()
        .then(res => {
            if (res.done) {
                // TODO: Throw error if the decoder still holds onto some
                // undecoded bytes!
                return res;
            }
            res.value = this._encoder.encode(res.value);
            return res;
        });
    }
    cancel(reason) {
        this._reader.cancel(reason);
    }
}

module.exports = {
    // Utilities
    toReader: toReader,
    toStream: toStream,
    readToArray: readToArray,
    readToString: readToString,
    // Text encode / decode (to/from byte) stream conversions
    TextDecodeReader: TextDecodeReader,
    TextEncodeReader: TextEncodeReader,
    // Chunk evaluation
    FlatStreamReader: FlatStreamReader,
};

},{}],2:[function(require,module,exports){
'use strict';

const SELECTOR_RE = /^\s*([^\[\s]+)\s*(?:\[\s*([^=\^*~\$\s]+)\s*(?:([\^\$~\*]?=)\s*"([^\]]*)"\s*)?\])?\s*$/;

const valueDecodeTable = {
    'n': '\n',
    'r': '\r',
    't': '\t',
    'f': '\f',
    '"': '"',
    '\\': '\\'
};


/**
 * Simple CSS selector parser.
 *
 * Limitations:
 * - Only supports single attribute selector.
 */
function parseCSSSelector(selector) {
    const match = SELECTOR_RE.exec(selector);
    if (!match) {
        throw new Error("Unsupported or invalid CSS selector: " + selector);
    }
    const res = { nodeName: match[1].trim() };
    if (match[2]) {
        const attr = [match[2]];
        if (match[3]) { attr.push(match[3]); }
        // Decode the attribute value
        if(match[4]) {
            attr.push(match[4].replace(/\\([nrtf"\\])/g, function(_, k) {
                return valueDecodeTable[k];
            }));
        }
        res.attributes = [attr];
    }
    return res;
}

module.exports = parseCSSSelector;

},{}],3:[function(require,module,exports){
'use strict';

const streamUtil = require('web-stream-util');
const parseCSSSelector = require('./cssSelectorParser');

// Shared patterns
const optionalAttributePattern = '(?:\\s+[a-zA-Z_-]+(?:=(?:"[^"]*"|\'[^\']*\'))?)*';
const remainingTagAssertionPattern = `(?=${optionalAttributePattern}\\s*\\/?>)`;
const remainingTagCloseCapturePattern = `${optionalAttributePattern}\\s*(\\/?)>`;
const remainingTagPattern = `${optionalAttributePattern}\\s*\\/?>`;
const ANY_TAG = new RegExp(`<(\/?)([a-zA-Z][a-zA-Z0-9_-]*)${remainingTagCloseCapturePattern}`, 'g');

// https://www.w3.org/TR/html-markup/syntax.html#syntax-attributes:
// Attribute names must consist of one or more characters other than the space
// characters, U+0000 NULL, """, "'", ">", "/", "=", the control characters,
// and any characters that are not defined by Unicode.
const ATTRIB_NAME_PATTERN = '[^\\s\\0"\'>/=\x00-\x1F\x7F-\x9F]+';
const ATTRIB_PATTERN = `\\s+(${ATTRIB_NAME_PATTERN})=(?:"([^"]*)"|'([^']*)')|`;
const ATTRIB = new RegExp(ATTRIB_PATTERN, 'g');
const TAG_END = new RegExp('\\s*(\/?)>|', 'g');

function escapeRegex(re) {
    return re.replace(/[\^\\$*+?.()|{}\[\]\/]/g, '\\$&');
}

const attrValReplacements = {
    'double': {
        '<': '(?:<|&lt;)',
        '>': '(?:>|&gt;)',
        '&': '(?&|&amp;)',
        '"': '&quot;',
        "'": '(?:\'|&apos;|&#39;)',
    }
};
attrValReplacements.single = Object.assign({},
    attrValReplacements.double, {
        '"': '(?:"|&quot;)',
        "'": '(?:\'|&apos;|&#39;)',
    });

// Entity decoding. We only support the small set of entities actually used by
// HTML5 serialized as UTF8.
const entityDecodeMap = {
    '&amp;': '&',
    '&quot;': '"',
    '&#39;': "'",
    '&lt;': '<',
    '&gt;': '>',
};
function decodeEntities(s) {
    return s.replace(/&[#a-zA-Z0-9]+;/g, function(match) {
        const decoded = entityDecodeMap[match];
        if (!decoded) {
           throw new Error("Unsupported entity: " + match);
        }
        return decoded;
    });
}


/**
 * Element matcher.
 */
class HTMLTransformReader {

     /* Construct a Matcher instance.
      *
      * @param {array|Matcher} spec. One of:
      *   1) An array of rule definitions:
      *      - A `selector` {object} definition, containing
      *        - a `nodeName` {string}, and (optionally)
      *        - `attributes, an array of attribute match definitions:
      *           - `name`: The attribute name.
      *           - `operator`: One of "=", "^=" etc.
      *           - `value`: Expected attribute value or pattern.
      *      - A `handler`, function(node, ctx)
      *      - Optionally, a `stream` boolean. When set, the handler is passed
      *      `innerHTML` and `outerHTML` as a `ReadableStream` instance.
      *   2) A Matcher instance. In this case, the spec & pre-compiled
      *      matchers of that instance are reused, which is significantly more
      *      efficient. Match state and options are unique to the new
      *      instance.
      * @param {object} options (optional)
      *      - {boolean} matchOnly (optional): Only include matches in the values; drop
      *      unmatched content.
      *      - {object} ctx (optional): A context object passed to handlers.
      */
    constructor(input, options) {
        this._rawInput = input;
        this._reader = streamUtil.toReader(input);
        this._options = options || {};
        this._transforms = this._options.transforms;
        this._closed = false;
        this._matchedSome = false;
        if (!this._transforms) {
            throw new Error("No spec supplied!");
        }
        this._re = {};
        if (this._transforms._cache) {
            this._re = this._transforms._cache;
        } else {
            this._normalizeTransforms();
            this._makeMatchers(this._transforms);
            // Efficient matcher for random Tags.
            this._transforms._cache = this._re;
        }
        this._reset();
    }

    _normalizeTransforms() {
        // Convert spec to a Matcher spec.
        this._transforms.forEach(rule => {
            if (typeof rule.selector === 'string') {
                rule.selector = parseCSSSelector(rule.selector);
            }
        });
    }

    _reset() {
        // Reset match state.
        this._activeMatcher = null;
        this._activeMatcherArgs = null;
        this._buffer = '';
        this._lastIndex = 0;
        this._matches = [];
    }

    cancel() {
        this._reset();
        if (this._reader && this._reader.cancel) {
           this._reader.cancel();
        }
    }

    read() {
        return this._reader.read()
        .then(res => {
            if (res.done) {
                if (this._matches.length) {
                    const matches = this._matches;
                    this._matches = [];
                    return {
                        value: matches,
                        done: false
                    };
                }
                if (this._buffer) {
                    const e = new Error("Incomplete match. Remaining: " + this._buffer.slice(0,100));
                    this._reset();
                    throw e;
                }
                this._closed = true;
                return res;
            }
            const matchRes = this._match(res.value);
            if (!matchRes.done && matchRes.value.length === 0) {
                // Read some more until we can return something.
                return this.read();
            }
            if (matchRes.done && matchRes.value.length) {
                matchRes.done = false;
            }
            return matchRes;
        });
    }

    drainSync() {
        if (typeof this._rawInput !== 'string') {
            throw new Error("drainSync() is only supported for plain string inputs!");
        }
        this._closed = true;
        const res = this._match(this._rawInput);
        if (!res.done) {
            this._reset();
            throw new Error("Incomplete match.");
        }
        return res.value;
    }

    /**
     * Pull from sub-streams. These don't directly return matches, but push
     * matched chunks to sub-streams for elements.
     */
    _pull(controller) {
        return this._reader.read()
            .then(res => {
                if (res.done) {
                    this._closed = true;
                    return;
                }
                // ElementMatch enqueue / close happens
                // implicitly as part of recursive call.
                this._matches = this._matches.concat(this._match(res.value).value);
                if (!this._matchedSome && !this._matches.length && !controller._isClosed) {
                    return this._pull(controller);
                }
            });
    }

    /**
     * Match a document, a chunk at a time.
     *
     * @param {string} chunk
     * @return {object}
     *   - {array<string|mixed>} value, an array of literal strings
     *   interspersed with handler return values for matches.
     *   - {boolean} done, whether the matcher has matched a complete
     *   document.
     */
    _match(chunk) {
        const re = this._re;
        this._buffer += chunk;
        this._lastIndex = 0;
        this._matchedSome = false;

        // Main document parse loop.
        let prevIndex;
        do {
            prevIndex = this._lastIndex;
            if (!this._activeMatcher) {
                // Explicitly match tags & attributes to avoid matching literal
                // `<` in attribute values. These are escaped with `&lt;` in XML,
                // but not HTML5.
                re.nonTargetStartTag.lastIndex = this._lastIndex;
                re.nonTargetStartTag.exec(this._buffer);
                if (re.nonTargetStartTag.lastIndex !== this._lastIndex) {
                    // Matched some content.
                    if (!this._options.matchOnly) {
                        this._matchedSome = true;
                        // Add to matches.
                        this._matches.push(this._buffer.slice(this._lastIndex,
                            re.nonTargetStartTag.lastIndex));
                    }
                    this._lastIndex = re.nonTargetStartTag.lastIndex;
                }
                if (re.nonTargetStartTag.lastIndex === this._buffer.length) {
                    // All done.
                    this._lastIndex = 0;
                    this._buffer = '';
                    break;
                }
                this._activeMatcherArgs = null;
                prevIndex = this._lastIndex;
            }

            this._matchElement();
        } while (this._lastIndex !== prevIndex);

        const matches = this._matches;
        this._matches = [];
        return {
            value: matches,
            // Normally we should not return done when there were still
            // matches, but we fix that up in read(). Doing it this way
            // simplifies synchronous matching with drainSync().
            done: !this._buffer && this._closed
        };
    }

    _matchTagEnd() {
        TAG_END.lastIndex = this._lastIndex;
        const match = TAG_END.exec(this._buffer);
        this._lastIndex = TAG_END.lastIndex;
        return !!match[1];
    }

    _matchElement() {
        let args = this._activeMatcherArgs;
        const re = this._re;
        if (!args) {
            // First call.
            re.targetTag.lastIndex = this._lastIndex;

            // Try to match a target tag.
            const targetMatch = re.targetTag.exec(this._buffer);
            // Match the remainder of the element.

            if (!targetMatch) {
                // Can't match a targetTag yet. Wait for more input.
                this._buffer = this._buffer.slice(this._lastIndex);
                this._lastIndex = 0;
                return;
            }

            this._activeMatcher = this._matchElement;
            this._lastIndex = re.targetTag.lastIndex;

            if (!targetMatch[1]) {
                // Start tag.

                // The attribute match is guaranteed to complete, as our targetTag
                // regexp asserts that the entire tag (incl attributes) is
                // available.
                const attributes = this._matchAttributes();

                // Consume the tag end & update this._lastIndex
                // XXX: Also support serialization of self-closing tags
                // without /> by checking nodeName against a list of
                // self-closing tags? Would need look-ahead to consume
                // optional end tag in that case.
                const isSelfClosingTag = this._matchTagEnd();

                // Set up elementMatcherArgs
                this._activeMatcherArgs = args = {};
                // Look up the handler matching the selector, by group index.
                for (let i = 2; i < targetMatch.length; i++) {
                    let tagMatch = targetMatch[i];
                    if (tagMatch !== undefined) {
                        args.rule = this._transforms[i-2];
                        break;
                    }
                }
                args.node = {
                    nodeName: args.rule.selector.nodeName,
                    attributes,
                    outerHTML: this._buffer.slice(re.nonTargetStartTag.lastIndex, this._lastIndex),
                    innerHTML: '',
                };

                if (isSelfClosingTag) {
                    // Close out the match.
                    if (args.rule.stream) {
                        args.node.outerHTML = new ReadableStream({
                            start: constroller => {
                                controller.enqueue(args.node.outerHTML);
                                controller.close();
                            }
                        });
                        args.node.innerHTML = new ReadableStream({
                            start: constroller => controller.close()
                        });
                    }
                    this._matches.push(args.rule.handler(args.node, this._options.ctx));
                    this._activeMatcher = null;
                    this._activeMatcherArgs = null;
                    return;
                }

                if (args.rule.stream) {
                    args.node.outerHTML = new ReadableStream({
                        start: controller => {
                            controller.enqueue(args.node.outerHTML);
                            args.outerHTMLController = controller;
                        },
                        pull: controller => this._pull(controller)
                    });
                    args.node.innerHTML = new ReadableStream({
                        start: controller => {
                            args.innerHTMLController = controller;
                        },
                        pull: controller => this._pull(controller)
                    });
                    // Call the handler
                    this._matches.push(args.rule.handler(args.node, this._options.ctx));
                }
                args.depth = 1;
            } else {
                throw new Error("Stray end tag!");
            }
        }

        re.anyTag.lastIndex = this._lastIndex;

        while (true) {
            let lastAnyIndex = re.anyTag.lastIndex;
            // Efficiently skip over tags we aren't interested in.
            re.otherTag.lastIndex = lastAnyIndex;
            re.otherTag.exec(this._buffer);
            if (re.otherTag.lastIndex > lastAnyIndex) {
                lastAnyIndex = re.otherTag.lastIndex;
                re.anyTag.lastIndex = re.otherTag.lastIndex;
            }
            // Inspect the next (potentially interesting) tag more closely.
            const match = re.anyTag.exec(this._buffer);
            if (!match) {
                // Can't complete a match.
                if (lastAnyIndex) {
                    // Matched *some* content.
                    this._matchedSome = true;
                    if (args.rule.stream) {
                        const chunk = this._buffer.substring(this._lastIndex,
                            lastAnyIndex);
                        args.outerHTMLController.enqueue(chunk);
                        args.innerHTMLController.enqueue(chunk);
                        this._buffer = this._buffer.slice(lastAnyIndex);
                        this._lastIndex = 0;
                    } else {
                        // Hold onto the entire input for the element.
                        this._buffer = this._buffer.slice(this._lastIndex);
                        this._lastIndex = 0;
                    }
                    return;
                } else {
                    // Repeat read until we can return a chunk.
                    this.read().then(res => {
                        if (!res.done) {
                            this._matches = this._matches.concat(res.value);
                        }
                    });
                    return;
                }
            }

            if (match[2] === args.rule.selector.nodeName) {
                if (match[1]) {
                    // End tag
                    args.depth--;
                    if (args.depth === 0) {
                        this._matchedSome = true;
                        const outerChunk = this._buffer.substring(this._lastIndex,
                                re.anyTag.lastIndex);
                        const innerChunk = this._buffer.substring(this._lastIndex, match.index);
                        if (args.rule.stream) {
                            args.outerHTMLController.enqueue(outerChunk);
                            args.outerHTMLController.close();
                            args.outerHTMLController._isClosed = true;
                            args.innerHTMLController.enqueue(innerChunk);
                            args.innerHTMLController.close();
                            args.innerHTMLController._isClosed = true;
                        } else {
                            args.node.outerHTML += outerChunk;
                            args.node.innerHTML += innerChunk;
                            // Call the handler
                            this._matches.push(args.rule.handler(args.node, this._options.ctx));
                        }

                        this._lastIndex = re.anyTag.lastIndex;
                        this._activeMatcher = null;
                        this._activeMatcherArgs = null;
                        return;
                    }
                } else if (!match[3]) {
                    // Start tag.
                    args.depth++;
                }
            }
        }
    }

    _matchAttributes() {

        ATTRIB.lastIndex = this._lastIndex;
        const attributes = {};
        while (true) {
            const match = ATTRIB.exec(this._buffer);
            if (match[0].length === 0) {
                break;
            }
            let val = match[2] || match[3];
            if (val.indexOf('&') !== -1) {
                // Decode HTML entities
                val = decodeEntities(val);
            }
            attributes[match[1]] = val;
        }
        this._lastIndex = ATTRIB.lastIndex;
        return attributes;
    }

    _makeMatchers(spec) {
        const self = this;
        this.lastIndex = 0;
        // Need:
        // - Start tag matcher. Safe, as '<' is always escaped, including
        // attributes.
        // - Random tag matcher. Match as long as level reaches zero.


        const tagMatchPatterns = spec
            .map(rule => self._compileTagMatcher(rule.selector));
        // Never match <script> by default
        tagMatchPatterns.push('script');

        // HTML comments, or IE conditional comments.
        const commentMatchPattern = '!(?:--[\\s\\S]*?--|\\[(?:end)?if[^\\]]*\\])>';
        // A bit of a hack. Step over <script> content unconditionally.
        // TODO: Support matching <script> elements.
        const scriptStyleMatchPattern = 's(?:cript|tyle)\\s?[^>]*>(?:(?!<\/s(?:cript|tyle)>)[\\s\\S])*?</s(?:cript|tyle)>|s(?:cript|tyle)\\s?[^>]*/>';

        // A matcher for the tags we are *not* interested in. Used in HTML5 mode.
        const tagMatchAssertions = tagMatchPatterns
            .map(pattern => '(?:' + pattern + ')')
            .join('|');
        this._re.nonTargetStartTag = new RegExp(`[^<]*(?:<(?:[\\/! ]*(?!${
            tagMatchAssertions
        })[a-zA-Z][a-zA-Z0-9_-]*${remainingTagPattern}|${commentMatchPattern}|${scriptStyleMatchPattern})[^<]*)*`, 'g');

        const nodeNames = new Set();
        spec.forEach(rule => nodeNames.add(rule.selector.nodeName));
        const nodeNameRe = Array.from(nodeNames.keys()).join('|');

        this._re.otherTag = new RegExp(`[^<]*(?:<(?:[\\/!\s]*(?!${nodeNameRe})[a-zA-Z][a-zA-Z0-9_-]*${remainingTagPattern}|${commentMatchPattern}|${scriptStyleMatchPattern})[^<]*)+|`, 'g');

        // A matcher for the tags we *are* actually interested in.
        this._re.targetTag = new RegExp(`<(\\/?)(?:${tagMatchPatterns
        .map(pattern => '(' + pattern + ')')
        .join('|')})${remainingTagAssertionPattern}`, 'g');

        this._re.anyTag = ANY_TAG;
    }

    _quoteAttributeValue(s, mode) {
        if (/[<'">&]/.test(s)) {
            const map = attrValReplacements[mode];
            // Escape any regexp chars in the value
            s = escapeRegex(s);
            return s.replace(/[<'">&]/g, m => map[m]);
        } else {
            return s;
        }
    }

    _compileTagMatcher(selector) {
        if (!selector.nodeName) {
            throw new Error("Only matches for fixed tag names are supported for now!");
        }
        const attributes = selector.attributes;
        let res = selector.nodeName || '';
        if (attributes && attributes.length) {
            if (attributes.length > 1) {
                throw new Error("Only a single attribute match is supported for now!");
            }
            const attributeSelector = attributes[0];
            // Only match on the first attribute
            const attr = {
                name: attributeSelector[0],
                operator: attributeSelector[1],
                value: attributeSelector[2]
            };

            res += `(?=[^>]*?\\s${attr.name}`;
            const doubleQuoteValuePattern = this._quoteAttributeValue(attr.value, 'double');
            const singleQuoteValuePattern = this._quoteAttributeValue(attr.value, 'single');
            if (!attr.operator) {
                 res += '=(?:"[^"]*"|\'[^\']*\'))';
            } else if (attr.operator === '=') {
                res += `=(?:"${doubleQuoteValuePattern}"|'${singleQuoteValuePattern}'))`;
            } else if (attr.operator === '^=') {
                res += `=(?:"${doubleQuoteValuePattern}[^"]*"|'${singleQuoteValuePattern}[^']*'))`;
            } else if (attr.operator === '$=') {
                res += `=(?:"[^"]*${doubleQuoteValuePattern}"|'[^']*${singleQuoteValuePattern}'))`;
            } else if (attr.operator === '~=') {
                res += `=(?:"(?:[^"]+\\s+)*${doubleQuoteValuePattern}(?:\\s+[^"]+)*"|'(?:[^']+\\s)*${singleQuoteValuePattern}(?:\\s[^']+)*'))`;
            } else if (attr.operator === '*=') {
                res += `=(?:"[^"]*${doubleQuoteValuePattern}[^"]*"|'[^']*${singleQuoteValuePattern}[^']*'))`;
            } else {
                throw new Error(`Unsupported attribute predicate: ${attr.operator}`);
            }
        }
        return res;
    }
}

module.exports = {
    HTMLTransformReader: HTMLTransformReader,
};

},{"./cssSelectorParser":2,"web-stream-util":4}],4:[function(require,module,exports){
arguments[4][1][0].apply(exports,arguments)
},{"dup":1}],5:[function(require,module,exports){
'use strict';

const streamUtil = require('../index.js');
const HTMLTransformReader = require('web-html-stream').HTMLTransformReader;

/**
 * General setup
 */
const handler = function(node) {
    // Simplistic runtime handler, which lets us reuse match structures
    // between renders. For parallel & once-only content processing, we
    // could just do whatever we need to do & return a Promise directly.
    return function() {
        return node.outerHTML;
    };
};
const testDoc = "<html><body><div>"
    + "<test-element foo='bar'>foo</test-element>"
    + "</div></body>";

const precompiledTemplate = new HTMLTransformReader(testDoc, {
    transforms: [
        { selector: 'test-element[foo="bar"]', handler },
        { selector: 'foo-bar', handler },
    ]
}).drainSync();

function evalTemplate(tpl) {
    // Set up the stream transforms & get the reader.
    const reader = new streamUtil.FlatStreamReader(tpl, {});
    return streamUtil.readToArray(reader);
}

// Pre-compile the test doc into a template (array of chunks). Our handler
// returns functions for dynamic elements, so that we can re-evaluate the
// template at runtime.
  var start = Date.now();
  var n = 50000;
  var count = 0;

  for (var i = 0; i <= n; i++) {
    evalTemplate(precompiledTemplate).then(() => {
      count++;
      if ( count === n ) {
        console.log(`Wikipedia: ${Date.now() - start} ms.`);
      }
    });
  }


},{"../index.js":1,"web-html-stream":3}]},{},[5]);
