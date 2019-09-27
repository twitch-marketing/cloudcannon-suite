var async = require("async"),
	fs = require("fs-extra"),
	del = require("del"),
	c = require("ansi-colors"),
	log = require("fancy-log"),
	path = require("path"),
	defaults = require("defaults"),
	webserver = require("gulp-webserver"),
	prop = require("properties"),
	props2json = require("gulp-props2json"),
	i18n = require("./plugins/i18n"),
	rename = require("gulp-rename"),
	through = require("through2").obj,
	PythonShell = require("python-shell");

var configDefaults = {
	i18n: {
		src: "dist/site",
		dest: "dist/translated_site",

		default_language: "en",
		locale_src: "i18n/locales",
		generated_locale_dest: "i18n",

		legacy_path: "_locales",


		show_duplicate_locale_warnings: true,
		show_missing_locale_warnings: true,
		show_skipped_updates: true,

		character_based_locales: ["ja", "ja_jp", "ja-jp"],
		google_credentials_filename: null
	},
	serve: {
		port: 8000,
		open: true,
		path: "/"
	}
};

module.exports = function (gulp, config) {
	var gulpSequence = require('gulp-sequence').use(gulp)

	config = config || {};

	config.i18n = defaults(config.i18n, configDefaults.i18n);
	config.serve = defaults(config.serve, configDefaults.serve);

	var cwd = process.cwd();
	config.i18n._src = config.i18n.src;
	config.i18n._dest = config.i18n.dest;
	config.i18n._locale_src = config.i18n.locale_src;
	config.i18n._generated_locale_dest = config.i18n.generated_locale_dest;
	config.i18n._legacy_path = config.i18n.legacy_path;

	config.i18n.src = path.join(cwd, config.i18n.src);
	config.i18n.dest = path.join(cwd, config.i18n.dest);
	config.i18n.locale_src = path.join(cwd, config.i18n.locale_src);
	config.i18n.generated_locale_dest = path.join(cwd, config.i18n.generated_locale_dest);
	config.i18n.legacy_path = path.join(cwd, config.i18n.legacy_path);

	function runBudou(targetLocale, inputFilename, outputFilename, done) {
		var options = {
			mode: 'text',
			scriptPath: __dirname,
			args: [config.i18n.google_credentials_filename, inputFilename, outputFilename, targetLocale]
		};

		PythonShell.run('wordwrap-json.py', options, done);
	}

	function readLocalesFromDir(dir, done) {
		var returnedLocales = {};
		fs.readdir(dir, function(err, files) {
			if (err) {
				log(c.red("Unable to read locales") + " from "
					+ c.blue(dir) + ": " + err.message);
				return done(err);
			}

			async.each(files, function (filename, next) {
				if (!/\.json$/.test(filename)) {
					return next();
				}

				fs.readFile(path.join(dir, filename), function read(err, data) {
					if (err) {
						log(err);
						return next(err);
					}

					var key = filename.replace(/\.json$/, "");
					try {
						returnedLocales[key] = JSON.parse(data);
					} catch (e) {
						log(c.red("Malformed JSON") + " from "
							+ c.blue(dir + "/" + filename) + ": " + e.message);
					}

					for (var localeKey in returnedLocales[key]) {
						if (returnedLocales[key].hasOwnProperty(localeKey)) {
							returnedLocales[key][localeKey] = {
								translation: returnedLocales[key][localeKey],
								count: 0
							};
						}
					}
					next();
				});
			}, function (err) {
				done(err, returnedLocales);
			});
		});
	}

	// -------
	// Legacy

	// Transfers properties files from the old CloudCannon format
	// to the new i18n folder structure
	gulp.task("i18n:legacy-transfer",  function (done) {
		log(c.green("Transferring files") + " from "
			+ c.blue(config.i18n.legacy_path + "/*.properties")
			+ " to "
			+ c.blue(config.i18n.locale_src));

		return gulp.src(config.i18n.legacy_path + "/*.properties")
			.pipe(props2json({ minify: false }))
			.pipe(gulp.dest(config.i18n.locale_src));
	});

	// Transfers json files from the new CloudCannon format
	// to the old i18n folder structure
	gulp.task("i18n:legacy-update", gulpSequence("i18n:load-locales", "i18n:add-character-based-wordwraps", "i18n:load-wordwraps", "i18n:legacy-save-to-properties-files"));

	gulp.task("i18n:legacy-save-to-properties-files", function (done) {
		log(c.green("Transferring files") + " from "
			+ c.blue(config.i18n.locale_src + "/*.json")
			+ " to "
			+ c.blue(config.i18n.legacy_path));

		async.each(localeNames, function (localeName, next) {
			if (localeName === config.i18n.default_language) {
				return next();
			}

			var json = {};
			for (var key in locales[localeName]) {
				if (locales[localeName].hasOwnProperty(key)) {
					json[key] = locales[localeName][key].translation;
				}
			}

			if (localeName === "th") {
				localeName = "th_TH";
			}

			fs.writeFile(
				path.join(config.i18n.legacy_path, localeName.replace(/\-/g, "_") + ".properties"),
				prop.stringify(json),
				next);
		}, done);
	});

	// ---------------
	// Generate Source

	gulp.task("i18n:generate",  function (done) {
		log(c.green("Generating source locale") + " from "
			+ c.blue(config.i18n._src)
			+ " to "
			+ c.blue(config.i18n._generated_locale_dest));

		return gulp.src(config.i18n._src + "/**/*.html")
			.pipe(i18n.generate({
				showDuplicateLocaleWarnings: config.i18n.show_duplicate_locale_warnings
			}))
			.pipe(gulp.dest(config.i18n._generated_locale_dest));
	});


	// --------------
	// Translate Site

	var locales, localeNames; // holds locales between stages

	gulp.task("i18n:load-locales", function (done) {
		readLocalesFromDir(config.i18n.locale_src, function (err, returnedLocales) {
			if (!err) {
				locales = returnedLocales;
				locales[config.i18n.default_language] = null;
				localeNames = Object.keys(locales);
			}
			done(err);
		});
	});

	gulp.task("i18n:load-wordwraps", function (done) {
		if (!config.i18n.google_credentials_filename) {
			return done();
		}

		var wrappedDir = path.join(config.i18n.locale_src, "../wrapped");
		readLocalesFromDir(wrappedDir, function (err, returnedLocales) {
			if (!err) {
				for (var localeName in returnedLocales) {
					if (returnedLocales.hasOwnProperty(localeName)) {
						log(localeName + " loaded from wrapped");
						locales[localeName] = returnedLocales[localeName];
					}
				}
			}

			done(err);
		});
	});

	gulp.task("i18n:clone-assets",  function () {
		return gulp.src([config.i18n.src + "/**/*", "!" + config.i18n.src + "/**/*.html"], { nodir: true })
			.pipe(gulp.dest(config.i18n.dest));
	});


	class Partition {
		constructor(config) {
			let options = { count: 1, partition: 1, ...config };

			// log('I18N_PARTITION_COUNT', process.env.I18N_PARTITION_COUNT);
			// log('I18N_PARTITION_NUMBER', process.env.I18N_PARTITION_NUMBER);

			this.count = process.env.I18N_PARTITION_COUNT || options.count || 1;
			this.currentPartition = process.env.I18N_PARTITION_NUMBER || options.partition || 1;
			this.items = [];
			this.partitionItems = [];
		}
		
		get build() {
			return through((file, enc, done) => {
				this.items.push(file.path);
				done(null, file);
			}, (cb) => {
				let { items, currentPartition, count } = this;
				let totalCount = items.length;
				let size = Math.ceil(totalCount / count);
				let start = currentPartition * size;
	
				log('partitionItems', { totalCount, size, start, currentPartition, count });
	
				this.partitionItems = items.slice(start, size);
				cb();
			});
		}

		get filter() {
			return through((file, enc, done) => {
				if (this.partitionItems.includes(file.path)) {
					log('match', file);
					done(null, file);
				}
				else {
					done();
				}
			});
		}
	}

	gulp.task("i18n:translate-html-pages", function (done) {
		async.each(localeNames, function (targetLocale, next) {
			const partition = new Partition(config.i18n.partition)

			return gulp.src(config.i18n.src + "/**/*.html")
				.pipe(partition.build)
				.pipe(partition.filter)
				.pipe(i18n.translate({
					showMissingLocaleWarnings: config.i18n.show_missing_locale_warnings,
					addOtherLocaleAlternates: true,
					targetLocale: targetLocale,
					localeNames: localeNames,
					locales: locales
				})).pipe(rename(function (path) {
					path.dirname = path.dirname.replace(/^\/+/, "") || ".";
				})).pipe(gulp.dest(path.join(config.i18n.dest, targetLocale)))
				.on('end', next);
		}, done);
	});

	gulp.task("i18n:generate-redirect-html-pages", function (done) {
		return gulp.src(config.i18n.src + "/**/*.html")
			.pipe(i18n.redirectPage({
				defaultLocale: config.i18n.default_language,
				localeNames: localeNames,
				locales: locales
			})).pipe(gulp.dest(config.i18n.dest))
	});

	gulp.task("i18n:clone-prelocalised-html-pages", function (done) {
		async.each(localeNames, function (targetLocale, next) {
			return gulp.src(config.i18n.src + "/" + targetLocale + "/**/*.html")
				.pipe(i18n.translate({
					showSkippedUpdates: config.i18n.show_skipped_updates,
					showMissingLocaleWarnings: config.i18n.show_missing_locale_warnings,
					addOtherLocaleAlternates: false,
					targetLocale: targetLocale,
					localeNames: localeNames,
					locales: locales
				}))
				.pipe(gulp.dest(config.i18n.dest + "/" + targetLocale))
				.on('end', next);
		}, done);
	});

	// ---------
	// Wordwraps

	gulp.task("i18n:add-character-based-wordwraps", ["i18n:load-locales"], function (done) {
		if (!config.i18n.google_credentials_filename) {
			return done();
		}

		var wrappedDir = path.join(config.i18n.locale_src, "../wrapped");

		fs.ensureDir(wrappedDir, function () {
			async.eachSeries(localeNames, function (targetLocale, next) {
				if (config.i18n.character_based_locales.indexOf(targetLocale) < 0) {
					return next();
				}

				var inputFilename = path.join(config.i18n.locale_src, targetLocale + ".json"),
					outputFilename = path.join(wrappedDir, targetLocale + ".json");

				runBudou(targetLocale, inputFilename, outputFilename, function (err) {
					if (err) {
						console.error(targetLocale + ": failed to wrap", err);
						return next(err);
					}

					log(targetLocale + ": is absolutely wrapped!");
					return next();
				});
			}, done);
		});
	});

	gulp.task("i18n:clean", function () {
		return del(config.i18n.dest);
	});

	// -----
	// Build

	gulp.task("i18n:build", gulpSequence(
		"i18n:clean",
		"i18n:load-locales",
		"i18n:add-character-based-wordwraps",
		"i18n:load-wordwraps",
		"i18n:clone-assets",
		"i18n:translate-html-pages",
		"i18n:clone-prelocalised-html-pages",
		"i18n:generate-redirect-html-pages"
	));

	// -----
	// Serve

	gulp.task("i18n:watch", function () {
		gulp.watch(config.i18n._locale_src + "/**/*", ["i18n:build"]);
		gulp.watch(config.i18n._src + "/**/*", ["i18n:build", "i18n:generate"]);
	});

	gulp.task("i18n:serve", ["i18n:build"], function() {
		return gulp.src(config.i18n.dest)
			.pipe(webserver({
				port: config.serve.port
			}));
	});


	// -------
	// Default

	gulp.task("i18n", gulpSequence("i18n:serve", "i18n:watch"));

	gulp.task("i18n:kickoff", gulpSequence("dev:build", ["i18n:generate", "screenshots:dev"]));
};
