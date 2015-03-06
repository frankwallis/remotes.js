/**
 * This is the base Remote constructor to inherit from.
 *
 * You do not actually use this constructor;
 * you extend from it with Remote.extend().
 */

!(function(global) {
  "use strict";

  var hasOwn = Object.prototype.hasOwnProperty;
  var undefined; // More compressible than void 0.
  var iteratorSymbol =
    typeof Symbol === "function" && Symbol.iterator || "@@iterator";

  var inModule = typeof module === "object";
  var runtime = global.regeneratorRuntime;
  if (runtime) {
    if (inModule) {
      // If regeneratorRuntime is defined globally and we're in a module,
      // make the exports object identical to regeneratorRuntime.
      module.exports = runtime;
    }
    // Don't bother evaluating the rest of this file if the runtime was
    // already defined globally.
    return;
  }

  // Define the runtime globally (as expected by generated code) as either
  // module.exports (if we're in a module) or a new, empty object.
  runtime = global.regeneratorRuntime = inModule ? module.exports : {};

  function wrap(innerFn, outerFn, self, tryLocsList) {
    return new Generator(innerFn, outerFn, self || null, tryLocsList || []);
  }
  runtime.wrap = wrap;

  // Try/catch helper to minimize deoptimizations. Returns a completion
  // record like context.tryEntries[i].completion. This interface could
  // have been (and was previously) designed to take a closure to be
  // invoked without arguments, but in all the cases we care about we
  // already have an existing method we want to call, so there's no need
  // to create a new function object. We can even get away with assuming
  // the method takes exactly one argument, since that happens to be true
  // in every case, so we don't have to touch the arguments object. The
  // only additional allocation required is the completion record, which
  // has a stable shape and so hopefully should be cheap to allocate.
  function tryCatch(fn, obj, arg) {
    try {
      return { type: "normal", arg: fn.call(obj, arg) };
    } catch (err) {
      return { type: "throw", arg: err };
    }
  }

  var GenStateSuspendedStart = "suspendedStart";
  var GenStateSuspendedYield = "suspendedYield";
  var GenStateExecuting = "executing";
  var GenStateCompleted = "completed";

  // Returning this object from the innerFn has the same effect as
  // breaking out of the dispatch switch statement.
  var ContinueSentinel = {};

  // Dummy constructor functions that we use as the .constructor and
  // .constructor.prototype properties for functions that return Generator
  // objects. For full spec compliance, you may wish to configure your
  // minifier not to mangle the names of these two functions.
  function GeneratorFunction() {}
  function GeneratorFunctionPrototype() {}

  var Gp = GeneratorFunctionPrototype.prototype = Generator.prototype;
  GeneratorFunction.prototype = Gp.constructor = GeneratorFunctionPrototype;
  GeneratorFunctionPrototype.constructor = GeneratorFunction;
  GeneratorFunction.displayName = "GeneratorFunction";

  runtime.isGeneratorFunction = function(genFun) {
    var ctor = typeof genFun === "function" && genFun.constructor;
    return ctor
      ? ctor === GeneratorFunction ||
        // For the native GeneratorFunction constructor, the best we can
        // do is to check its .name property.
        (ctor.displayName || ctor.name) === "GeneratorFunction"
      : false;
  };

  runtime.mark = function(genFun) {
    genFun.__proto__ = GeneratorFunctionPrototype;
    genFun.prototype = Object.create(Gp);
    return genFun;
  };

  runtime.async = function(innerFn, outerFn, self, tryLocsList) {
    return new Promise(function(resolve, reject) {
      var generator = wrap(innerFn, outerFn, self, tryLocsList);
      var callNext = step.bind(generator.next);
      var callThrow = step.bind(generator["throw"]);

      function step(arg) {
        var record = tryCatch(this, null, arg);
        if (record.type === "throw") {
          reject(record.arg);
          return;
        }

        var info = record.arg;
        if (info.done) {
          resolve(info.value);
        } else {
          Promise.resolve(info.value).then(callNext, callThrow);
        }
      }

      callNext();
    });
  };

  function Generator(innerFn, outerFn, self, tryLocsList) {
    var generator = outerFn ? Object.create(outerFn.prototype) : this;
    var context = new Context(tryLocsList);
    var state = GenStateSuspendedStart;

    function invoke(method, arg) {
      if (state === GenStateExecuting) {
        throw new Error("Generator is already running");
      }

      if (state === GenStateCompleted) {
        // Be forgiving, per 25.3.3.3.3 of the spec:
        // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorresume
        return doneResult();
      }

      while (true) {
        var delegate = context.delegate;
        if (delegate) {
          var record = tryCatch(
            delegate.iterator[method],
            delegate.iterator,
            arg
          );

          if (record.type === "throw") {
            context.delegate = null;

            // Like returning generator.throw(uncaught), but without the
            // overhead of an extra function call.
            method = "throw";
            arg = record.arg;

            continue;
          }

          // Delegate generator ran and handled its own exceptions so
          // regardless of what the method was, we continue as if it is
          // "next" with an undefined arg.
          method = "next";
          arg = undefined;

          var info = record.arg;
          if (info.done) {
            context[delegate.resultName] = info.value;
            context.next = delegate.nextLoc;
          } else {
            state = GenStateSuspendedYield;
            return info;
          }

          context.delegate = null;
        }

        if (method === "next") {
          if (state === GenStateSuspendedStart &&
              typeof arg !== "undefined") {
            // https://people.mozilla.org/~jorendorff/es6-draft.html#sec-generatorresume
            throw new TypeError(
              "attempt to send " + JSON.stringify(arg) + " to newborn generator"
            );
          }

          if (state === GenStateSuspendedYield) {
            context.sent = arg;
          } else {
            delete context.sent;
          }

        } else if (method === "throw") {
          if (state === GenStateSuspendedStart) {
            state = GenStateCompleted;
            throw arg;
          }

          if (context.dispatchException(arg)) {
            // If the dispatched exception was caught by a catch block,
            // then let that catch block handle the exception normally.
            method = "next";
            arg = undefined;
          }

        } else if (method === "return") {
          context.abrupt("return", arg);
        }

        state = GenStateExecuting;

        var record = tryCatch(innerFn, self, context);
        if (record.type === "normal") {
          // If an exception is thrown from innerFn, we leave state ===
          // GenStateExecuting and loop back for another invocation.
          state = context.done
            ? GenStateCompleted
            : GenStateSuspendedYield;

          var info = {
            value: record.arg,
            done: context.done
          };

          if (record.arg === ContinueSentinel) {
            if (context.delegate && method === "next") {
              // Deliberately forget the last sent value so that we don't
              // accidentally pass it on to the delegate.
              arg = undefined;
            }
          } else {
            return info;
          }

        } else if (record.type === "throw") {
          state = GenStateCompleted;

          if (method === "next") {
            context.dispatchException(record.arg);
          } else {
            arg = record.arg;
          }
        }
      }
    }

    generator.next = invoke.bind(generator, "next");
    generator["throw"] = invoke.bind(generator, "throw");
    generator["return"] = invoke.bind(generator, "return");

    return generator;
  }

  Gp[iteratorSymbol] = function() {
    return this;
  };

  Gp.toString = function() {
    return "[object Generator]";
  };

  function pushTryEntry(locs) {
    var entry = { tryLoc: locs[0] };

    if (1 in locs) {
      entry.catchLoc = locs[1];
    }

    if (2 in locs) {
      entry.finallyLoc = locs[2];
      entry.afterLoc = locs[3];
    }

    this.tryEntries.push(entry);
  }

  function resetTryEntry(entry) {
    var record = entry.completion || {};
    record.type = "normal";
    delete record.arg;
    entry.completion = record;
  }

  function Context(tryLocsList) {
    // The root entry object (effectively a try statement without a catch
    // or a finally block) gives us a place to store values thrown from
    // locations where there is no enclosing try statement.
    this.tryEntries = [{ tryLoc: "root" }];
    tryLocsList.forEach(pushTryEntry, this);
    this.reset();
  }

  runtime.keys = function(object) {
    var keys = [];
    for (var key in object) {
      keys.push(key);
    }
    keys.reverse();

    // Rather than returning an object with a next method, we keep
    // things simple and return the next function itself.
    return function next() {
      while (keys.length) {
        var key = keys.pop();
        if (key in object) {
          next.value = key;
          next.done = false;
          return next;
        }
      }

      // To avoid creating an additional object, we just hang the .value
      // and .done properties off the next function object itself. This
      // also ensures that the minifier will not anonymize the function.
      next.done = true;
      return next;
    };
  };

  function values(iterable) {
    if (iterable) {
      var iteratorMethod = iterable[iteratorSymbol];
      if (iteratorMethod) {
        return iteratorMethod.call(iterable);
      }

      if (typeof iterable.next === "function") {
        return iterable;
      }

      if (!isNaN(iterable.length)) {
        var i = -1, next = function next() {
          while (++i < iterable.length) {
            if (hasOwn.call(iterable, i)) {
              next.value = iterable[i];
              next.done = false;
              return next;
            }
          }

          next.value = undefined;
          next.done = true;

          return next;
        };

        return next.next = next;
      }
    }

    // Return an iterator with no values.
    return { next: doneResult };
  }
  runtime.values = values;

  function doneResult() {
    return { value: undefined, done: true };
  }

  Context.prototype = {
    constructor: Context,

    reset: function() {
      this.prev = 0;
      this.next = 0;
      this.sent = undefined;
      this.done = false;
      this.delegate = null;

      this.tryEntries.forEach(resetTryEntry);

      // Pre-initialize at least 20 temporary variables to enable hidden
      // class optimizations for simple generators.
      for (var tempIndex = 0, tempName;
           hasOwn.call(this, tempName = "t" + tempIndex) || tempIndex < 20;
           ++tempIndex) {
        this[tempName] = null;
      }
    },

    stop: function() {
      this.done = true;

      var rootEntry = this.tryEntries[0];
      var rootRecord = rootEntry.completion;
      if (rootRecord.type === "throw") {
        throw rootRecord.arg;
      }

      return this.rval;
    },

    dispatchException: function(exception) {
      if (this.done) {
        throw exception;
      }

      var context = this;
      function handle(loc, caught) {
        record.type = "throw";
        record.arg = exception;
        context.next = loc;
        return !!caught;
      }

      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        var record = entry.completion;

        if (entry.tryLoc === "root") {
          // Exception thrown outside of any try block that could handle
          // it, so set the completion value of the entire function to
          // throw the exception.
          return handle("end");
        }

        if (entry.tryLoc <= this.prev) {
          var hasCatch = hasOwn.call(entry, "catchLoc");
          var hasFinally = hasOwn.call(entry, "finallyLoc");

          if (hasCatch && hasFinally) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            } else if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else if (hasCatch) {
            if (this.prev < entry.catchLoc) {
              return handle(entry.catchLoc, true);
            }

          } else if (hasFinally) {
            if (this.prev < entry.finallyLoc) {
              return handle(entry.finallyLoc);
            }

          } else {
            throw new Error("try statement without catch or finally");
          }
        }
      }
    },

    _findFinallyEntry: function(finallyLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc <= this.prev &&
            hasOwn.call(entry, "finallyLoc") && (
              (entry.finallyLoc === finallyLoc || this.prev < entry.finallyLoc))) {
          return entry;
        }
      }
    },

    abrupt: function(type, arg) {
      var entry = this._findFinallyEntry();
      var record = entry ? entry.completion : {};

      record.type = type;
      record.arg = arg;

      if (entry) {
        this.next = entry.finallyLoc;
      } else {
        this.complete(record);
      }

      return ContinueSentinel;
    },

    complete: function(record, afterLoc) {
      if (record.type === "throw") {
        throw record.arg;
      }

      if (record.type === "break" ||
          record.type === "continue") {
        this.next = record.arg;
      } else if (record.type === "return") {
        this.rval = record.arg;
        this.next = "end";
      } else if (record.type === "normal" && afterLoc) {
        this.next = afterLoc;
      }

      return ContinueSentinel;
    },

    finish: function(finallyLoc) {
      var entry = this._findFinallyEntry(finallyLoc);
      return this.complete(entry.completion, entry.afterLoc);
    },

    "catch": function(tryLoc) {
      for (var i = this.tryEntries.length - 1; i >= 0; --i) {
        var entry = this.tryEntries[i];
        if (entry.tryLoc === tryLoc) {
          var record = entry.completion;
          if (record.type === "throw") {
            var thrown = record.arg;
            resetTryEntry(entry);
          }
          return thrown;
        }
      }

      // The context.catch method must only be called with a location
      // argument that corresponds to a known catch block.
      throw new Error("illegal catch attempt");
    },

    delegateYield: function(iterable, resultName, nextLoc) {
      this.delegate = {
        iterator: values(iterable),
        resultName: resultName,
        nextLoc: nextLoc
      };

      return ContinueSentinel;
    }
  };
})(
  // Among the various tricks for obtaining a reference to the global
  // object, this seems to be the most reliable technique that does not
  // use indirect eval (which violates Content Security Policy).
  typeof global === "object" ? global :
  typeof window === "object" ? window : this
);

var EventEmitter = require('events').EventEmitter;
var validate = require('component-validator');
var inherits = require('util').inherits;
var request = require('cogent');
var semver = require('semver');
var debower = require('./debower');
var utils = require('component-consoler');

module.exports = Remote;

inherits(Remote, EventEmitter);

/**
 * Extend a constructor from the currency constructor.
 * Usage:
 *
 *   function GitHub(options) {
 *     if (!(this instanceof GitHub)) return new Github(options)
 *     options = options || {}
 *     Remote.call(this, options)
 *   }
 *
 *   Remote.extend(GitHub)
 *
 * @param {Remote} this
 * @param {Function} Child
 * @return Child
 * @api public
 */

Remote.extend = function (Child) {
  inherits(Child, this);
  Object.keys(this).forEach(function (key) {
    Child[key] = this[key]
  }, this)
  return Child
}

/**
 * @param {Object} options
 * @api public
 */

function Remote(options) {
  options = options || {}

  // you'll get a lot of error messages others
  // if you have a large app with a lot of
  // shared dependencies
  this.setMaxListeners(options.maxListeners || Infinity);

  this.request = request.extend(options);

  // we handle retires ourselves
  this.retries = options.retries || 1;

  // cache for component versions
  this.c_versions = Object.create(null);

  // cache for component@version's component.json
  this.c_json = Object.create(null);

  // cache for component@version's git tree
  this.c_tree = Object.create(null);
}

/**
 * So you don't have to differentiate between a `remotes` instance and a `Remote` instance.
 *
 * @return {this}
 * @api public
 */

Remote.prototype.resolve = regeneratorRuntime.mark(function callee$0$0(remotes, repo, ref) {
  var versions, reference, json;

  return regeneratorRuntime.wrap(function callee$0$0$(context$1$0) {
    while (1) switch (context$1$0.prev = context$1$0.next) {
    case 0:
      if (!(typeof remotes === 'string')) {
        context$1$0.next = 5;
        break;
      }

      ref = repo;
      repo = remotes;
      context$1$0.next = 7;
      break;
    case 5:
      if (!(Array.isArray(remotes) && !~remotes.indexOf(this.name))) {
        context$1$0.next = 7;
        break;
      }

      return context$1$0.abrupt("return");
    case 7:
      return context$1$0.delegateYield(this.getAvailableVersions(remotes, repo, ref), "t4", 8);
    case 8:
      versions = context$1$0.t4;

      // TODO: this looks not good, should return null or something like that
      if (versions == null) versions = ['master'];

      // add master, if there are no versions published
      if (versions.length === 0) versions.push('master');

      reference = ref || versions[0];
      return context$1$0.delegateYield(this.json(repo, reference), "t5", 13);
    case 13:
      json = context$1$0.t5;

      if (!json) {
        context$1$0.next = 16;
        break;
      }

      return context$1$0.abrupt("return", this);
    case 16:
    case "end":
      return context$1$0.stop();
    }
  }, callee$0$0, this);
});

Remote.prototype.isValid = regeneratorRuntime.mark(function callee$0$1(remotes, repo, ref) {
  var versions;

  return regeneratorRuntime.wrap(function callee$0$1$(context$1$0) {
    while (1) switch (context$1$0.prev = context$1$0.next) {
    case 0:
      return context$1$0.delegateYield(this.getAvailableVersions(remotes, repo, ref), "t6", 1);
    case 1:
      versions = context$1$0.t6;

      if (!(versions == null)) {
        context$1$0.next = 4;
        break;
      }

      return context$1$0.abrupt("return", false);
    case 4:
      return context$1$0.abrupt("return", true);
    case 5:
    case "end":
      return context$1$0.stop();
    }
  }, callee$0$1, this);
});

/**
 * There are two use cases for this function:
 * 1. Just to check if a repo exist via isValid()
 * 2. Get available versions
 *
 * @return {this}
 * @api public
 */
Remote.prototype.getAvailableVersions = regeneratorRuntime.mark(function callee$0$2(remotes, repo, ref) {
  var availableVersions;

  return regeneratorRuntime.wrap(function callee$0$2$(context$1$0) {
    while (1) switch (context$1$0.prev = context$1$0.next) {
    case 0:
      if (!(typeof remotes === 'string')) {
        context$1$0.next = 5;
        break;
      }

      ref = repo;
      repo = remotes;
      context$1$0.next = 7;
      break;
    case 5:
      if (!(Array.isArray(remotes) && !~remotes.indexOf(this.name))) {
        context$1$0.next = 7;
        break;
      }

      return context$1$0.abrupt("return");
    case 7:
      return context$1$0.delegateYield(this.versions(repo), "t7", 8);
    case 8:
      availableVersions = context$1$0.t7;
      return context$1$0.abrupt("return", availableVersions);
    case 10:
    case "end":
      return context$1$0.stop();
    }
  }, callee$0$2, this);
});

/**
 * Caching wrapper around getting component versions.
 * Filter by valid semantic versions and order them descendingly.
 *
 * @param {String} repo
 * @return {Array} references
 * @api public
 */

Remote.prototype.versions = regeneratorRuntime.mark(function callee$0$3(repo) {
  var event, cache, references, versions;

  return regeneratorRuntime.wrap(function callee$0$3$(context$1$0) {
    while (1) switch (context$1$0.prev = context$1$0.next) {
    case 0:
      if (!repo) {
        console.log("repo: "+repo);
        console.log(new Error().stack);
      }

      repo = repo.toLowerCase();
      event = 'version:' + repo;
      cache = this.c_versions;

      if (!(repo in cache)) {
        context$1$0.next = 13;
        break;
      }

      if (!(cache[repo] === 'resolving')) {
        context$1$0.next = 11;
        break;
      }

      context$1$0.next = 8;
      return this.await(event);
    case 8:
      context$1$0.t8 = context$1$0.sent;
      context$1$0.next = 12;
      break;
    case 11:
      context$1$0.t8 = cache[repo];
    case 12:
      return context$1$0.abrupt("return", context$1$0.t8);
    case 13:
      cache[repo] = 'resolving';
      context$1$0.prev = 14;
      return context$1$0.delegateYield(this._versions(repo), "t9", 16);
    case 16:
      references = context$1$0.t9;
      context$1$0.next = 21;
      break;
    case 19:
      context$1$0.prev = 19;
      context$1$0.t10 = context$1$0["catch"](14);
    case 21:
      versions = cache[repo] = references
        ? references.filter(valid).sort(semver.rcompare)
        : null;

      this.emit(event, versions);
      return context$1$0.abrupt("return", versions);
    case 24:
    case "end":
      return context$1$0.stop();
    }
  }, callee$0$3, this, [[14, 19]]);
});

/**
 * Caching wrapper around getting a component.json.
 *
 * @param {String} repo
 * @param {String} reference
 * @return {Object} component.json
 * @api public
 */

Remote.prototype.json = regeneratorRuntime.mark(function callee$0$4(repo, ref) {
  var slug, event, cache, json, bower, valid;

  return regeneratorRuntime.wrap(function callee$0$4$(context$1$0) {
    while (1) switch (context$1$0.prev = context$1$0.next) {
    case 0:
      repo = repo.toLowerCase();
      slug = repo + '@' + ref;
      event = 'json:' + slug;
      cache = this.c_json;

      if (!(slug in cache)) {
        context$1$0.next = 13;
        break;
      }

      if (!(cache[slug] === 'resolving')) {
        context$1$0.next = 11;
        break;
      }

      context$1$0.next = 8;
      return this.await(event);
    case 8:
      context$1$0.t11 = context$1$0.sent;
      context$1$0.next = 12;
      break;
    case 11:
      context$1$0.t11 = cache[slug];
    case 12:
      return context$1$0.abrupt("return", context$1$0.t11);
    case 13:
      cache[slug] = 'resolving';
      return context$1$0.delegateYield(this._json(repo, ref), "t12", 15);
    case 15:
      json = context$1$0.t12;

      if (json) {
        context$1$0.next = 23;
        break;
      }

      return context$1$0.delegateYield(this._bower(repo, ref), "t13", 18);
    case 18:
      bower = context$1$0.t13;

      if (!bower) {
        context$1$0.next = 23;
        break;
      }

      return context$1$0.delegateYield(debower(bower), "t14", 21);
    case 21:
      json = context$1$0.t14;
      utils.log("debower", "created component.json for bower repo " + repo);
    case 23:
      if (json) {
        // fix properties like .repo,
        // but not log anything because we're not npm.
        // there's nothing end users can do.
        validate(json, {
          verbose: false
        });
        valid = semver.valid(ref);
        // overwrite the version in case it wasn't updated
        if (valid) json.version = valid;

        // add a repo property
        // to do: handle redirects
        if (!json.repository) json.repository = repo;
      } else {
        // i don't like `undefined`s
        json = null;
      }
      cache[slug] = json;
      this.emit(event, json);
      return context$1$0.abrupt("return", json);
    case 27:
    case "end":
      return context$1$0.stop();
    }
  }, callee$0$4, this);
});

/**
 * Caching wrapper around getting a component's tree.
 * Should be a list of files with the following properties:
 *
 *   - sha - sha1sum
 *   - path
 *   - size
 *
 * This is pretty slow - avoid using it.
 *
 * @param {String} repo
 * @param {String} ref
 * @return {Array} objects
 * @api public
 */

Remote.prototype.tree = regeneratorRuntime.mark(function callee$0$5(repo, ref) {
  var slug, event, cache, tree;

  return regeneratorRuntime.wrap(function callee$0$5$(context$1$0) {
    while (1) switch (context$1$0.prev = context$1$0.next) {
    case 0:
      repo = repo.toLowerCase();
      slug = repo + '@' + ref;
      event = 'tree:' + slug;
      cache = this.c_tree;

      if (!(slug in cache)) {
        context$1$0.next = 13;
        break;
      }

      if (!(cache[slug] === 'resolving')) {
        context$1$0.next = 11;
        break;
      }

      context$1$0.next = 8;
      return this.await(event);
    case 8:
      context$1$0.t15 = context$1$0.sent;
      context$1$0.next = 12;
      break;
    case 11:
      context$1$0.t15 = cache[slug];
    case 12:
      return context$1$0.abrupt("return", context$1$0.t15);
    case 13:
      cache[slug] = 'resolving';
      return context$1$0.delegateYield(this._tree(repo, ref), "t16", 15);
    case 15:
      tree = context$1$0.t16;
      tree = tree || null;
      cache[slug] = tree;
      this.emit(event, tree);
      return context$1$0.abrupt("return", tree);
    case 20:
    case "end":
      return context$1$0.stop();
    }
  }, callee$0$5, this);
});

/**
 */

Remote.prototype.file = function () {
  /*
  return []
  */
}

/**
 */

Remote.prototype.archive = function () {
  /*
  return {
    zip: [],
    tar: [],
  }
  */
}

/**
 * Await an event. Returns the event.
 * This is useful for waiting for inflight requests to finish.
 *
 * @param {String} event
 * @api private
 */

Remote.prototype.await = function (event) {
  var self = this
  return function (done) {
    self.once(event, function (result) {
      done(null, result)
    })
  }
}

// check is a version is valid
function valid(x) {
  return semver.valid(x);
}
