(function(){
	var origModuleFn,
		$injector = null,
		logMode = null,
		metadata = {
			configBlocks: [],
			runBlocks: [],
			tempMocks: {}
		};

	var constants = {
			PREFIX: '___'
		},
		providers = {
			provider: 'provider',
			factory: 'factory',
			service: 'service',
			value: 'value',
			constant: 'constant',
			decorator: 'decorator',
			animation: 'animation',
			filter: 'filter',
			controller: 'controller',
			directive: 'directive',
			component: 'component',
			config: 'config',
			run: 'run'
		},
		excludedProviders = {
			//directive: 'directive',
			//component: 'component',
			value: 'value',
			constant: 'constant',
			config: 'config',
			run: 'run'
		};

	quickmock.log = {
		DEBUG: 'DEBUG',
		WARN: 'WARN',
		NONE: 'NONE'
	};

	quickmock.USE_ACTUAL = 'USE_ACTUAL';

	quickmock.setLogMode = function quickmockSetDebugMode(mode){
		if(quickmock.log[mode]){
			logMode = mode;
		}
	};

	quickmock.setLogMode(quickmock.log.WARN);

	return window.quickmock = initQuickmock();

	function quickmock(options){
		if(!options.providerName || !(options.moduleNames || options.moduleName) || !metadata[options.providerName]) return false;

		options.moduleNames = getAllModuleNames(options);

		$injector = angular.injector(options.moduleNames, options.strictDi || false);

		if(angular.isFunction(options.inject)){
			$injector.invoke(options.inject);
		}

		var meta = metadata[options.providerName];
		meta.mocks = {};

		setupProviderMocks(meta, options);

		if(angular.isFunction(options.beforeInit)){
			options.beforeInit(meta.mocks);
		}

		var provider = initProviderForTesting(options.providerName, options);
		provider.$mocks = meta.mocks;

		return provider;
	}

	function initQuickmock(){
		if(!window.angular) return false;

		$injector = angular.injector();

		origModuleFn = angular.module;
		angular.module = moduleWrapper;
		return quickmock;
	}

	function initProvider(providerName, options){
		var meta = metadata[providerName];
		if(!meta){
			warn('quickmock: unknown provider', providerName);
		}
		switch(meta.type){
			case providers.controller:
				var $controller = $injector.get('$controller');
				return $controller(providerName, meta.mocks);
			case providers.filter:
				var $filter = $injector.get('$filter');
				return $filter(providerName);
			case providers.directive:
				return initDirective(options);
			default:
				return $injector.get(providerName);
		}
	}

	function initProviderForTesting(providerName, options){
		var meta = metadata[providerName];

		if(angular.isFunction(meta.configFn)){
			meta.configFn.$inject = meta.mockedDependencies;
		}

		var provider = initProvider(providerName, options);

		if(angular.isFunction(meta.configFn)){
			meta.configFn.$inject = meta.dependencies;
		}

		return provider;
	}

	function initDirective(options){
		var meta = metadata[options.providerName],
			$compile = $injector.get('$compile'),
			directive = {
				$scope: $injector.get('$rootScope').$new()
			};

		directive.$compile = function compileDirective(html){
			html = html || options.html;
			if(!html){
				throwError('QUICKMOCK: Cannot compile "', options.providerName, '" directive. No html string provided.');
			}
			directive.$element = angular.element(html);
			meta.configFn.$inject = meta.mockedDependencies;
			$compile(directive.$element)(directive.$scope);
			meta.configFn.$inject = meta.dependencies;
			directive.$isoScope = directive.$element.isolateScope();
			(directive.$isoScope || directive.$scope).$digest();
		};

		return directive;
	}

	function moduleWrapper(modName, requires, configFn){
		if(modName === 'ng') return false;
		var mod = origModuleFn(modName, requires, configFn);

		angular.forEach(providers, function(methodName){
			if(!excludedProviders[methodName] && angular.isFunction(mod[methodName])){
				var origMethod = mod[methodName],
					mockMethodName = 'mock' + methodName.charAt(0).toUpperCase() + methodName.slice(1);
				mod[mockMethodName] = wrapProviderMockDefinition(methodName, origMethod, mod);
				mod[methodName] = wrapProviderDefinition(methodName, origMethod, mod);
				mod[mockMethodName + 'Spy'] = wrapProviderMockSpyDefinition(mod[mockMethodName]);
				mod[mockMethodName + 'SpyObj'] = wrapProviderMockSpyObjDefinition(mod[mockMethodName]);
			}
		});

		mod.useActual = wrapProviderActualImplementation(mod.mockFactory);

		mod.mockValue = wrapProviderMockDefinition('value', mod.value, mod);
		mod.mockConstant = wrapProviderMockDefinition('constant', mod.constant, mod);

		mod.value = wrapValueOrConstant('value', mod.value, mod);
		mod.constant = wrapValueOrConstant('constant', mod.constant, mod);

		mod.run = wrapConfigOrRunBlock('run', mod);
		mod.config = wrapConfigOrRunBlock('config', mod);

		return mod;
	}

	function wrapProviderDefinition(methodName, callthrough, module){
		return function providerDefinition(name, configFn){
			var deps = $injector.annotate(configFn),
				mockedDeps = angular.copy(deps)
					.map(function(dep){
						return constants.PREFIX + dep;
					});
			configFn = angular.isArray(configFn) ? configFn[configFn.length-1] : configFn;
			configFn.$inject = deps;
			angular.extend(metadata[name] = metadata[name] || {}, {
				name: name,
				type: methodName,
				moduleName: module.name,
				dependencies: deps,
				mockedDependencies: mockedDeps,
				configFn: configFn,
				mockName: constants.PREFIX + name
			});

			return callthrough(name, configFn);
		};
	}

	function wrapConfigOrRunBlock(configOrRun, module){
		var callthrough = module[configOrRun];
		return function configOrRunBlock(configFn){
			var deps = $injector.annotate(configFn),
				mockedDeps = angular.copy(deps)
					.map(function(dep){
						return constants.PREFIX + dep;
					});
			configFn = angular.isArray(configFn) ? configFn[configFn.length-1] : configFn;
			configFn.$inject = deps;
			metadata[configOrRun + 'Blocks'].push({
				type: configOrRun,
				moduleName: module.name,
				dependencies: deps,
				mockedDependencies: mockedDeps,
				configFn: configFn
			});
			callthrough(configFn);
			return module;
		};
	}

	function wrapValueOrConstant(valueOrConst, callthrough, module){
		return function valueOrConstant(name, value){
			angular.extend(metadata[name] = metadata[name] || {}, {
				name: name,
				type: valueOrConst,
				moduleName: module.name,
				value: value,
				mockName: constants.PREFIX + name
			});
			return callthrough(name, value);
		};
	}

	function wrapProviderMockDefinition(type, callthrough, module){
		return function providerMockDefinition(name, configFn){
			var mockName = constants.PREFIX + name,
				deps = [];
			if(type !== providers.value && type !== providers.constant && angular.isFunction(configFn)){
				deps = $injector.annotate(configFn);
				configFn = angular.isArray(configFn) ? configFn[configFn.length-1] : configFn;
				configFn.$inject = deps;
			}
			angular.extend(metadata[mockName] = metadata[mockName] || {}, {
				isMock: true,
				name: mockName,
				configFn: configFn,
				isMockFor: name,
				type: type,
				dependencies: deps,
				mockDependencies: angular.copy(deps),
				moduleName: module.name
			});
			return callthrough(mockName, configFn);
		};
	}

	function wrapProviderMockSpyDefinition(callthrough){
		return function providerMockSpyDefinition(name, optionalCallback){
			if(!window.jasmine || !window.jasmine.createSpy){
				throwError('QUICKMOCK: cannot define mock spy for "' + name + '" because window.jasmine.createSpy is not a function');
			}
			return callthrough(name, function(){
				var spy = jasmine.createSpy(name),
					callbackResult = null;
				if(angular.isFunction(optionalCallback)){
					callbackResult = optionalCallback(spy);
				}
				return callbackResult || spy;
			});
		}
	}

	function wrapProviderMockSpyObjDefinition(callthrough){
		return function providerMockSpyObjDefinition(name, methods, optionalCallback){
			if(!window.jasmine || !window.jasmine.createSpyObj){
				throwError('QUICKMOCK: cannot define mock spy object for "' + name + '" because window.jasmine.createSpyObj is not a function');
			}
			return callthrough(name, function(){
				var spyObj = jasmine.createSpyObj(name, methods),
					callbackResult = null;
				if(angular.isFunction(optionalCallback)){
					callbackResult = optionalCallback(spyObj);
				}
				return callbackResult || spyObj;
			});
		}
	}

	function wrapProviderActualImplementation(callthrough){
		return function providerMockActualImplementation(name, optionalCallback){
			var configFn = function(dependency){
				var callbackResult = null;
				if(angular.isFunction(optionalCallback)){
					callbackResult = optionalCallback(dependency);
				}
				return callbackResult || dependency;
			};
			configFn.$inject = [name];
			return callthrough(name, configFn);
		}
	}

	function handleTemporaryMocks(mocks){
		var mod = angular.module('quickmockTempMocks_' + new Date().getTime(), []);
		angular.forEach(mocks, function(mock, name){
			if(mock === quickmock.USE_ACTUAL){
				mod.useActual(name);
			}else{
				var meta = (metadata[name] = metadata[name] || {}),
					tempMockName = constants.PREFIX + 'temp_' + name;
				meta.hasMock = true;
				meta.tempMock = mock;
				meta.tempMockName = tempMockName;
				mod.constant(tempMockName, mock);
			}
		});
		return mod;
	}

	function setupProviderMocks(meta, options){
		angular.forEach(meta.dependencies, function(depName, i){
			var depMeta = metadata[depName];
			if(!depMeta){
				debug('quickmock: metadata for dependency', depName, 'is unknown');
				if(metadata[constants.PREFIX + depName]){
					debug('quickmock: switching dependency', depName, 'to its mocked version');
					//depName = constants.PREFIX + depName;
					depMeta = metadata[constants.PREFIX + depName];
				}else{
					throw new Error('quickmock: unknown dependency "' + depName + '"');
				}
			}
			if(options.mocks && depMeta.tempMock){
				debug('quickmock: setting mock for', options.providerName, 'from "' + depName + '" to "' + depMeta.tempMockName + '"');
				meta.mocks[depName] = depMeta.tempMock;
				meta.mockedDependencies[i] = depMeta.tempMockName;
			}else if(depMeta.type === providers.value || depMeta.type === providers.constant){
				if($injector.has(depMeta.mockName)){
					debug('quickmock: setting mock for', options.providerName, depMeta.type, 'as "' + meta.mockedDependencies[i] + '"');
					meta.mocks[depName] = initProvider(meta.mockedDependencies[i], options);
				}else if($injector.has(depName)){
					debug('quickmock: setting mock for', options.providerName, depMeta.type, 'from "' + meta.mockedDependencies[i] + '" to "' + depName + '" because no mock exists');
					meta.mocks[depName] = initProvider(meta.mockedDependencies[i] = depName, options);
				}else{
					throwError('QUICKMOCK: no', depMeta.type, 'mock named "' + depName + '" was found');
				}
			}else{
				debug('quickmock: setting mock for', options.providerName, 'from "' + depName + '" to "' +  meta.mockedDependencies[i] + '"');
				meta.mocks[depName] = initProvider(meta.mockedDependencies[i], options);
			}
		});
	}

	function getAllModuleNames(options){
		var moduleNames = [];
		if(options.moduleNames){
			moduleNames = moduleNames.concat(options.moduleNames);
		}
		if(options.moduleName){
			moduleNames.push(options.moduleName);
		}
		if(options.mockModules){
			moduleNames = moduleNames.concat(options.mockModules);
		}
		if(options.mocks){
			var tempMockModule = handleTemporaryMocks(options.mocks);
			moduleNames.push(tempMockModule.name);
		}
		return ['ng','ngMock'].concat(moduleNames);
	}

	function getInvokeQueueForProvider(options){
		var meta = metadata[options.providerName],
			invokeQueue = angular.module(meta.moduleName)._invokeQueue;
		angular.forEach(invokeQueue, function(queue){
			log(queue[0], queue[1], Array.prototype.slice.call(queue[2]));
			//log('config', queue[2][1][2], queue[2][1][2] === meta.configFn);
		});
		//log(invokeQueue);
		return invokeQueue;
	}

	function debug(){
		if(logMode === quickmock.log.DEBUG){
			console.log(Array.prototype.slice.call(arguments).join(' '));
		}
	}

	function warn(){
		if(logMode == quickmock.log.WARN || logMode === quickmock.log.DEBUG){
			console.log(Array.prototype.slice.call(arguments).join(' '));
		}
	}

	function throwError(){
		throw new Error(Array.prototype.slice.call(arguments).join(' '));
	}

})();