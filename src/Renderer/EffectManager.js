/**
 * Renderer/EffectManager.js
 *
 * Effects Manager
 *
 * This file is part of ROBrowser, Ragnarok Online in the Web Browser (http://www.robrowser.com/).
 *
 * @author Vincent Thibault
 */
define(function( require )
{
	'use strict';


	/**
	 * Load dependencies
	 */
	var EffectDB      = require('DB/Effects/EffectTable');
	var SkillEffect   = require('DB/Skills/SkillEffect');
	var SkillUnit     = require('DB/Skills/SkillUnit');
	var ItemEffect    = require('DB/Items/ItemEffect');
	var Events        = require('Core/Events');
	var Cylinder      = require('Renderer/Effects/Cylinder');
	var StrEffect     = require('Renderer/Effects/StrEffect');
	var TwoDEffect    = require('Renderer/Effects/TwoDEffect');
	var ThreeDEffect  = require('Renderer/Effects/ThreeDEffect');
	var Entity        = require('Renderer/Entity/Entity');
	var EntityManager = require('Renderer/EntityManager');
	var Renderer      = require('Renderer/Renderer');
	var Altitude      = require('Renderer/Map/Altitude');
	var Sound         = require('Audio/SoundManager');
	var Preferences   = require('Preferences/Map');


	/**
	 * @var {object} saved webgl context
	 */
	var _gl;


	/**
	 * @var {object} effect listing
	 */
	var _list = {};


	/**
	 * @var {object} Effects namespace
	 */
	var EffectManager = {};


	/**
	 * @var {number} used to differenciate constructors
	 */
	var _uniqueId = 1;


	/**
	 * Initialize effects manager
	 */
	EffectManager.init = function init(gl)
	{
		_gl = gl;
	};


	/**
	 * Add effect to the render list
	 *
	 * @param {function} effect
	 * @param {mixed} effect unique id
	 * @param {boolean} persistent
	 */
	EffectManager.add = function add(effect, uid, persistent)
	{
		var name = (effect.constructor._uid || (effect.constructor._uid = (_uniqueId++)));
		
		if (!(name in _list)) {
			_list[name] = [];

			if (effect.constructor.init) {
				effect.constructor.init(_gl);
			}

			if (!effect.constructor.renderBeforeEntities) {
				effect.constructor.renderBeforeEntities = false;
			}
		}

		if (effect.init) {
			effect.init(_gl);
		}

		effect._uid        = uid;
		effect._persistent = !!persistent;

		_list[name].push(effect);
	};


	/**
	 * Remove an effect
	 *
	 * @param {effect}
	 * @param {mixed} effect unique id
	 */
	EffectManager.remove = function removeClosure()
	{
		function clean(name, uid) {
			var list;
			var i, count;

			list  = _list[name];
			count = list.length;

			for (i = 0; i < count; ++i) {
				if (list[i]._uid === uid) {
					if (list[i].free) {
						list[i].free(_gl);
					}
					list.splice(i, 1);
					i--;
					count--;
				}
			}

			if (!count) {
				//if (effect.free) {
				//	effect.free(_gl);
				//}
				delete _list[name];
			}
		}

		return function remove(effect, uid)
		{
			if (!effect || !(effect.name in _list)) {
				var i, count;
				var keys = Object.keys(_list);

				for (i = 0, count = keys.length; i < count; ++i) {
					clean( keys[i], uid);
				}

				return;
			} else {
				clean( effect.name, uid);
			}
		};
	}();


	/**
	 * Destroy all effects
	 */
	EffectManager.free = function free( gl )
	{
		var keys = Object.keys(_list);
		var i, j, size, count;
		var list, constructor;

		for (i = 0, count = keys.length; i < count; ++i) {
			list        = _list[ keys[i] ];
			constructor = list[0].constructor;

			for (j = 0, size = list.length; j < size; ++j) {
				if (list[j].free) {
					list[j].free(gl);
				}
			}

			if (constructor.free) {
				constructor.free(gl);
			}

			delete _list[ keys[i] ];
		}
	};


	/**
	 * Renderering all effects
	 *
	 * @param {object} webgl context
	 * @param {mat4} modelView matrix
	 * @param {mat4} projection matrix
	 * @param {mat3} normal matrix
	 * @param {object} fog structure
	 * @param {object} light structure
	 * @param {number} game tick
	 * @param {boolean} render before entities ?
	 */
	EffectManager.render = function render(gl, modelView, projection, fog, tick, renderBeforeEntities )
	{
		var keys = Object.keys(_list);
		var i, count = keys.length;
		var j, size;
		var list, constructor;

		for (i = 0; i < count; ++i) {
			list        = _list[ keys[i] ];

			if (!list.length) {
				delete _list[ keys[i] ];
				continue;
			}

			constructor = list[0].constructor;

			// Will be render after/before.
			if (constructor.renderBeforeEntities !== renderBeforeEntities) {
				continue;
			}

			if (constructor.ready) {
				constructor.beforeRender(gl, modelView, projection, fog, tick);

				for (j = 0, size = list.length; j < size; ++j) {
					if (list[j].ready) {
						list[j].render(gl, tick);
					}

					if (list[j].needCleanUp) {
						if (list[j]._persistent) {
							list[j].startTick   = tick;
							list[j].needCleanUp = false;
							continue;
						}

						if (list[j].free) {
							list[j].free(gl);
						}
						list.splice( j, 1);
						j--;
						size--;
					}
				}

				constructor.afterRender(gl);

				if (size === 0) {
					if (constructor.free) {
						constructor.free(gl);
					}
					delete _list[keys[i]];
				}
			}
		}
	};


	/**
	 * Spam an effect to the scene
	 *
	 * @param {number} effect id
	 * @param {number} owner aid
	 * @param {Array} position
	 * @param {number} tick
	 * @param {boolean} persistent
	 */
	EffectManager.spam = function spam( effectId, AID, position, tick, persistent )
	{
		var effects;
		var count, duplicate, timeBetweenDupli;
		// No effect mode (/effect)
		if (!Preferences.effect) {
			return;
		}

		// Not found
		if (!(effectId in EffectDB)) {
			return;
		}

		effects = EffectDB[effectId];
		tick    = tick || Renderer.tick;
		
		/*
		for (i = 0, count = effects.length; i < count; i++) {
			EffectManager.spamEffect(effects[i], AID, position, tick, persistent);
		}*/
		
		var duration, offset, cyn = 0;
		
		for (var i = 0, count = effects.length; i < count; ++i) {
			
            if (effects[i].duplicate == -1) duplicate = 999; //duplicates
            else duplicate = effects[i].duplicate ? effects[i].duplicate : 1;
			
            timeBetweenDupli = !isNaN(effects[i].timeBetweenDupli) ? effects[i].timeBetweenDupli : 200;
			
            for (var j = 0; j < duplicate; ++j) {
				EffectManager.spamEffect(effects[i], AID, cyn, position, offset, tick + timeBetweenDupli * j, persistent, duration);
			}
        }
	};


	/**
	 * Spam en effect
	 *
	 * @param {object} effect
	 * @param {number} AID
	 * @param {vec3} position
	 * @param {number} tick
	 * @param {boolean} persistent
	 */
	EffectManager.spamEffect = function spamEffect( effect, AID, cyn, position, offset, tick, persistent, duration)
	{
		var entity = EntityManager.get(AID);
		var filename;

		if (!position) {
			if (!entity) {
				return;
			}
			position = entity.position;
		}

		// Copy instead of get reference
		position   = effect.attachedEntity ? position : [ position[0], position[1], position[2] ];
		persistent = persistent || effect.repeat || false;

		// Play sound
		var delayWav = !isNaN(effect.delayWav) ? effect.delayWav : 0;
		if (effect.wav) {
			filename = effect.wav;
		
			if (effect.rand) {
				filename = filename.replace('%d', Math.round(effect.rand[0] + (effect.rand[1]-effect.rand[0]) * Math.random()));
			}

			Events.setTimeout(function(){
				Sound.play(filename + '.wav');
			}, tick + delayWav - Renderer.tick);
		}
		
		//Set delays
		var delay;
		if (duration) delay = duration;
		else delay = !isNaN(effect.delay) ? effect.delay : 1000;
		var delayOffset = !isNaN(effect.delayOffset) ? effect.delayOffset : 0;
		var delayLate = !isNaN(effect.delayLate) ? effect.delayLate : 0;
		
		switch (effect.type) {
			case 'SPR':
				spamSprite( effect, AID, position, tick, persistent );
				break;

			case 'STR':
				spamSTR( effect, AID, position, tick, persistent );
				break;

			case 'CYLINDER':
				//EffectManager.add(new Cylinder( position, effect, tick), AID);
				EffectManager.add(new Cylinder(position, effect, tick + delayOffset + delayLate, tick + delayOffset + delay), AID);
				break;
				
			case '2D':
				EffectManager.add(new TwoDEffect(position, effect, tick + delayOffset + delayLate, tick + delayOffset + delay, AID), AID);
				break;
			
			case '3D':
				EffectManager.add(new ThreeDEffect(position, offset, effect, tick + delayOffset + delayLate, tick + delayOffset + delay, AID), AID);
				break;
			
			case 'FUNC':
				if (effect.func) {
					if (effect.attachedEntity) {
						if (entity) {
							effect.func.call(this, entity, tick, AID);
						}
					}
					else {
						effect.func.call(this, position, tick, AID);
					}
				}
				break;
		}
	};


	/**
	 * Spam an effect to the scene
	 *
	 * @param {object} effect
	 * @param {number} owner aid
	 * @param {Array} position
	 * @param {number} tick
	 * @param {boolean} persistent
	 */
	function spamSTR( effect, AID, position, tick, persistent)
	{
		var filename;

		// Get STR file
		if (Preferences.mineffect && effect.min) {
			filename = effect.min;
		}
		else {
			filename = effect.file;
		}

		// Randomize STR file name
		if (effect.rand) {
			filename = filename.replace('%d', Math.round(effect.rand[0] + (effect.rand[1]-effect.rand[0]) * Math.random()) );
		}

		// Start effect
		EffectManager.add(new StrEffect('data/texture/effect/' + filename + '.str', position, tick), AID, persistent);
	}


	/**
	 * Spam an effect to the scene
	 *
	 * @param {object} effect
	 * @param {number} owner aid
	 * @param {Array} position
	 * @param {number} tick
	 * @param {boolean} persistent
	 */
	function spamSprite( effect, AID, position, tick, persistent)
	{
		var entity = EntityManager.get(AID);

		if (!entity) {
			entity            = new Entity();
			entity.GID        = AID;
			entity.position   = position;
			entity.objecttype = entity.constructor.TYPE_EFFECT;
		}

		else if (!effect.attachedEntity) {
			entity            = new Entity();
			entity.GID        = -1;
			entity.position   = position;
			entity.objecttype = entity.constructor.TYPE_EFFECT;
		}


		// Sprite effect
		entity.attachments.add({
			file:           effect.file,
			head:         !!effect.head,
			direction:    !!effect.direction,
			repeat:         effect.repeat,
			duplicate:		effect.duplicate,
			delayFrame:		effect.delayFrame,
			frame:			effect.frame,
			opacity:		effect.alphaMax,
			time_between_dupli:	effect.time_between_dupli,
			yOffset:		effect.yOffset,
			stopAtEnd:      effect.stopAtEnd
		});
		
		EntityManager.add(entity);
	}


	/**
	 * Spam effect on ground
	 *
	 * @param {number} unit id
	 * @param {number} position x
	 * @param {number} position y
	 * @param {number} skill unique id
	 */
	EffectManager.spamSkillZone = function spamUnit( unit_id, xPos, yPos, uid )
	{
		var skillId, effectId;
		var skill;
		
		// No effect mode (/effect)
		if (!Preferences.effect) {
			return;
		}

		if (!(unit_id in SkillUnit)) {
			return;
		}

		skillId = SkillUnit[unit_id];

		if (!(skillId in SkillEffect)) {
			return;
		}

		skill = SkillEffect[skillId];

		if (!skill.groundEffectId) {
			return;
		}

		effectId = skill.groundEffectId;

		if (!(effectId in EffectDB)) {
			return;
		}
		
		EffectManager.remove(null, uid);
		EffectManager.spam( effectId, uid, [ xPos, yPos, Altitude.getCellHeight( xPos, yPos) ], Renderer.tick, true);
	};


	/**
	 * Spam a skill on a target
	 *
	 * @param {number} skill id
	 * @param {number} target aid
	 * @param {Array} position
	 * @param {number} tick
	 */
	EffectManager.spamSkill = function spamSkill( skillId, destAID, position, tick, srcAID)
	{
		if (!(skillId in SkillEffect)) {
			return;
		}

		EffectManager.spam( SkillEffect[skillId].effectId, destAID, position, tick);
		
		if (SkillEffect[skillId].effectIdOnCaster && srcAID) {
			EffectManager.spam( SkillEffect[skillId].effectIdOnCaster, srcAID, position, tick);
		}
	};


	/**
	 * Spam skill hit
	 *
	 * @param {number} skill id
	 * @param {number} target aid
	 * @param {number} tick
	 */
	EffectManager.spamSkillHit = function spamSkillHit( skillId, AID, tick)
	{
		if (!(skillId in SkillEffect)) {
			return;
		}

		if (SkillEffect[skillId].hitEffectId) {
			EffectManager.spam( SkillEffect[skillId].hitEffectId, AID, null, tick);
		}
	};
	
	/**
	 * Spam a item on a target
	 *
	 * @param {number} item id
	 * @param {number} target aid
	 * @param {Array} position
	 * @param {number} tick
	 */
	EffectManager.spamItem = function spamItem( itemId, destAID, position, tick, srcAID)
	{
		if (!(itemId in ItemEffect)) {
			return;
		}

		EffectManager.spam( ItemEffect[itemId].effectId, destAID, position, tick);
		
		if (ItemEffect[itemId].effectIdOnCaster && srcAID) {
			EffectManager.spam( ItemEffect[itemId].effectIdOnCaster, srcAID, position, tick);
		}
	};


	/**
	 * Export
	 */
	return EffectManager;
});
