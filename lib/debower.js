var debug = require('debug')('remotes:debower');
var bowerapi = require('bower');

// cache for bower lookups
var lookupCache = Object.create(null);

/**
 * Convert a bower.json to a component.json
 *
 * Use the main field to populate main, scripts, styles, fonts etc
 * Convert bower dependencies into their github repos
 *
 * @param {Object} bower.json
 * @return {Object} component.json
 * @api public
 */
var debower = function* (bowerJson) {
  var result = {};

  result.name = bowerJson.name;
  result.description = bowerJson.description;
  result.version = bowerJson.version;
  result.license = bowerJson.license;
  result.keywords = bowerJson.keywords;
  result.repository = bowerJson.repository;

  /* Handle the exposed files */
  var main = bowerJson.main;

  if (!Array.isArray(main))
    main = [ main ];

  result.scripts = main.filter(function(filename) {
    return hasExtension(filename, [ "js", "ts", "coffee" ]);
  });

  result.styles = main.filter(function(filename) {
    return hasExtension(filename, [ "css", "scss", "less" ]);
  });

  result.templates = main.filter(function(filename) {
    return hasExtension(filename, [ "html", "jsx" ]);
  });

  result.json = main.filter(function(filename) {
    return hasExtension(filename, "json");
  });

  result.images = main.filter(function(filename) {
    return hasExtension(filename, [ "png", "jpg" ]);
  });

  result.fonts = main.filter(function(filename) {
    return hasExtension(filename, [ "eot", "svg", "ttf", "woff" ]);
  });

  if (result.scripts.length > 0)
    result.main = result.scripts[0];

  /* Convert all the dependencies */
  result.dependencies = {};

  for(var key in bowerJson.dependencies) {
    var qualified = yield lookup(key);
    result.dependencies[qualified] = bowerJson.dependencies[key];
  }

  /* Convert all the development dependencies */
  result.development = {};
  result.development.dependencies = {};

  for(var key in bowerJson.devDependencies) {
    var qualified = yield lookup(key);
    result.development.dependencies[qualified] = bowerJson.devDependencies[key];
  }

  return result;
}

/**
 * Find the GitHub repo for the bower package
 * and cache the result
 *
 * @param {String} bower package name
 * @return {String} github repo ([user]/[reponame])
 * @api private
 */
var lookup = function* (packageName) {
  var result = lookupCache[packageName];

  if (!result) {
    /* ok we need to do a bower lookup */
    result = yield bowerLookup(packageName);

    if (result) {
      debug("got " + packageName + " -> " + result);
      lookupCache[packageName] = result;
    }
  }

  return result;
}

/**
 * Call the bower api to get the repo name for the package
 *
 * @param {String} bower package name
 * @return {String} github repo ([user]/[reponame])
 * @api private
 */
var bowerLookup = function(packageName) {
  return function(done) {
    bowerapi
      .commands
      .lookup(packageName, {}, { /* custom config */ })
      .on('end', function(res) {
        var repo = "";
        var err = null;

        if (res && res.url) {
          var parts = res.url.split("/");
          repo = parts[parts.length -2] + "/" + parts[parts.length -1];
          // remove the '.git' extension
          if (hasExtension(repo, "git"))
            repo = repo.substr(0, repo.length - 4);
        } else {
          err = new Error("unable to find bower package '" + packageName + "'");
        }

        done(err, repo)
      });
    }
}

/**
 * Check if file has any of the supplied extensions
 *
 * @param {String} filename
 * @param {String|Array<String>} extensions
 * @return {Boolean} true if the file has one of the supplied extensions
 * @api private
 */
var hasExtension = function (filename, extensions) {
  if (!Array.isArray(extensions))
    extensions = [ extensions ];

  var fileext = filename.substr(filename.lastIndexOf('.') +1, filename.length);

  return extensions.some(function(ext) {
    return (fileext === ext);
  });
};

module.exports = debower;
