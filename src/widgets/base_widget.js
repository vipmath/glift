/**
 * The base web UI widget.  It can be extended, if necessary.
 */
glift.widgets.BaseWidget = function(
    divId, sgfOptions, displayOptions, actions, manager) {
  this.wrapperDiv = divId; // We split the wrapper div.
  this.type = sgfOptions.type;
  this.sgfOptions = glift.util.simpleClone(sgfOptions);
  this.displayOptions = glift.util.simpleClone(displayOptions);
  this.actions = actions; // deeply nested -- not worth cloning.
  this.manager = manager;

  // Used for problems, exclusively.
  // TODO(kashomon): Factor these out into some sort of problemState.
  this.correctness = undefined;
  this.correctNextSet = undefined;
  this.numCorrectAnswers = undefined;
  this.totalCorrectAnswers = undefined;

  this.controller = undefined; // Initialized with draw.
  this.display = undefined; // Initialized by draw.
  this.iconBar = undefined; // Initialized by draw.
  this.boardRegion = undefined; // Initialized by draw.
};

glift.widgets.BaseWidget.prototype = {
  /** Draw the widget. */
  draw: function() {
    this.controller = this.sgfOptions.controllerFunc(this.sgfOptions);
    glift.util.majorPerfLog('Created controller');

    this.displayOptions.intersections = this.controller.getIntersections();

    this.displayOptions.boardRegion =
        this.sgfOptions.boardRegion === glift.enums.boardRegions.AUTO
        ? glift.bridge.getCropFromMovetree(this.controller.movetree)
        : this.sgfOptions.boardRegion;
    this.displayOptions.rotation = this.sgfOptions.rotation;
    glift.util.majorPerfLog('Calculated board regions');

    // This should be the only time we get the base width and height, until the
    // entire widget is re-drawn.
    var parentDivBbox = glift.displays.bboxFromDiv(this.wrapperDiv);
    if (parentDivBbox.width() === 0 || parentDivBbox.height() === 0) {
      throw new Error("Div has has invalid dimensions. Bounding box had " +
          "width: " + parentDivBbox.width() +
          ", height: " + parentDivBbox.height());
    }

    // Recall that positioning returns an object that looks like:
    // {commentBox: ..., boardbox: ..., iconBarBox: ...)
    var positioning = glift.displays.positionWidget(
      parentDivBbox,
      this.displayOptions.boardRegion,
      this.displayOptions.intersections,
      this.sgfOptions.componentsToUse,
      this.displayOptions.oneColumnSplits,
      this.displayOptions.twoColumnSplits);

    var divIds = this._createDivsForPositioning(positioning, this.wrapperDiv);
    glift.util.majorPerfLog('Created divs');

    // TODO(kashomon): Remove these hacks. We shouldn't be modifying
    // displayOptions.
    this.displayOptions.divId = divIds.boardBoxId;

    var theme = glift.themes.get(this.displayOptions.theme);

    // TODO(kashomon): Pass in the theme rather than doing another copy here
    this.display = glift.displays.create(
        this.displayOptions,
        positioning.boardBox);
    glift.util.majorPerfLog('Finish creating display');

    divIds.commentBoxId && this._createCommentBox(
        divIds.commentBoxId,
        positioning.commentBox,
        theme);
    glift.util.majorPerfLog('CommentBox');

    divIds.iconBarBoxId && this._createIconBar(
        divIds.iconBarBoxId,
        positioning.iconBarBox,
        this.sgfOptions.icons,
        parentDivBbox, 
        theme);
    glift.util.majorPerfLog('IconBar');

    divIds.iconBarBoxId && this._initIconActions(
        this.iconBar, this.actions.iconActions);

    glift.util.majorPerfLog('Before stone event creation');
    this._initStoneActions(this.actions.stoneActions);
    this._initKeyHandlers();
    glift.util.majorPerfLog('After stone event creation');

    this._initProblemData();
    this.applyBoardData(this.controller.getEntireBoardState());
    return this;
  },

  _createDivsForPositioning: function(positioning, wrapperDiv) {
    var expectedKeys = 
        ['boardBox', 'iconBarBox', 'commentBox', 'extraIconBarBox'];
    var out = {};
    var that = this;
    var createDiv = function(bbox) {
      var newId = wrapperDiv + '_internal_div_' + glift.util.idGenerator.next();
      $('#' + wrapperDiv).append('<div id="' + newId + '"></div>');
      glift.displays.setNotSelectable(newId);
      // that._setNotSelectable(newId);
      var cssObj = {
        top: bbox.top(),
        left: bbox.left(),
        width: bbox.width(),
        height: bbox.height(),
        position: 'absolute'
      };
      $('#' + newId).css(cssObj);
      return newId;
    };
    for (var i = 0; i < expectedKeys.length; i++) {
      if (positioning[expectedKeys[i]]) {
        out[expectedKeys[i] + 'Id'] = createDiv(positioning[expectedKeys[i]]);
      }
    }
    return out;
  },

  _getProblemType: function() {
    var props = this.controller.movetree.properties();
    var probTypes = glift.enums.problemTypes;
    if (props.contains('EV')) {
      var value = props.getOneValue('EV').toUpperCase();
      if (probTypes[value] !== undefined && value !== probTypes.AUTO) {
        return value;
      }
    }
    if (this.controller.movetree.nextMoves().length === 0) {
      return probTypes.EXAMPLE;
    }
    return probTypes.STANDARD;
  },

  _createCommentBox: function(commentBoxId, positioning, theme) {
    this.commentBox = glift.displays.commentbox.create(
        commentBoxId, positioning, theme);
  },

  _createIconBar: function(iconId, bbox, icons, parentBbox, theme) {
    this.iconBar = glift.displays.icons.bar({
      theme: theme,
      divId: iconId,
      vertMargin: 5, // For good measure
      horzMargin: 5,
      icons: icons,
      positioning: bbox,
      parentBbox: parentBbox
    });
  },

  _initIconActions: function(iconBar, iconActions) {
    var hoverColors = { "BLACK": "BLACK_HOVER", "WHITE": "WHITE_HOVER" };
    var that = this;
    iconBar.forEachIcon(function(icon) {
      var iconName = icon.iconName;
      if (!iconActions.hasOwnProperty(icon.iconName)) {
        // Make sure that there exists an action specified in the
        // displayOptions, before we add any options.
        return
      }
      var actionsForIcon = {};

      actionsForIcon.click = iconActions[iconName].click;
      actionsForIcon.mouseover = iconActions[iconName].mouseover ||
        function(event, widgetRef, icon) {
          $('#' + icon.elementId)
              .attr('fill', widgetRef.iconBar.theme.icons['DEFAULT_HOVER'].fill);
        };
      actionsForIcon.mouseout = iconActions[iconName].mouseout ||
        function(event, widgetRef, icon) {
          $('#' + icon.elementId)
              .attr('fill', widgetRef.iconBar.theme.icons.DEFAULT.fill);
        };
      // TODO(kashomon): Add touch events conditionally based on the detected
      // browser.
      for (var eventName in actionsForIcon) {
        var eventFunc = actionsForIcon[eventName];
        // We init each action separately so that we avoid the lazy binding of
        // eventFunc.
        that._initOneIconAction(iconBar, iconName, eventName, eventFunc);
      }
    });
    iconBar.flushEvents();
  },

  _initOneIconAction: function(iconBar, iconName, eventName, eventFunc) {
    var widget = this;
    iconBar.setEvent(iconName, eventName, function(event, icon) {
      eventFunc(event, widget, icon, iconBar);
    });
  },

  /**
   * Initialize the stone actions.
   */
  _initStoneActions: function(baseActions) {
    var actions = {};
    actions.mouseover = baseActions.mouseover;
    actions.mouseout = baseActions.mouseout;
    actions.click = this.sgfOptions.stoneClick;
    if (this.sgfOptions.stoneMouseover) {
      actions.mouseover = this.sgfOptions.stoneMouseover;
    }
    if (this.sgfOptions.stoneMouseout) {
      actions.mouseout = this.sgfOptions.stoneMouseout;
    }


    var that = this;
    var wrapAction = function(func) {
      return function(event, pt) { func(event, that, pt); };
    };
    var that = this
    if (actions.mouseover && actions.mouseout) {
      this.display.intersections().setHover(
          wrapAction(actions.mouseover),
          wrapAction(actions.mouseout));
    }
    if (actions.click) {
      this.display.intersections().setEvent(
          'click', wrapAction(actions.click));
    }
  },

  /**
   * Assign Key actions to some other action.
   */
  _initKeyHandlers: function() {
    var that = this;
    this.keyHandlerFunc = function(e) {
      var name = glift.keyMappings.codeToName(e.which);
      if (name && that.sgfOptions.keyMappings[name] !== undefined) {
        var actionName = that.sgfOptions.keyMappings[name];
        // actionNamespaces look like: icons.arrowleft.mouseup
        var actionNamespace = actionName.split('.');
        var action = that.actions[actionNamespace[0]];
        for (var i = 1; i < actionNamespace.length; i++) {
          action = action[actionNamespace[i]];
        }
        action(e, that);
      }
    };
    $('body').keydown(this.keyHandlerFunc);
  },

  /**
   * Initialize properties based on problem type.
   */
  _initProblemData: function() {
    if (this.sgfOptions.widgetType ===
        glift.enums.widgetTypes.CORRECT_VARIATIONS_PROBLEM) {
      var correctNext = glift.rules.problems.correctNextMoves(
          this.controller.movetree, this.sgfOptions.problemConditions);
      // A Set: i.e., a map of points to true
      this.correctNextSet = this.correctNextSet || {};
      this.numCorrectAnswers = this.numCorrectAnswers || 0;
      this.totalCorrectAnswers = this.totalCorrectAnswers
          || this.sgfOptions.totalCorrectVariationsOverride
          || correctNext.length;
      // TODO(kashomon): Remove this hack: The icon should be specified with
      // some sort of options.
      this.iconBar.addTempText(
          'multiopen-boxonly',
          this.numCorrectAnswers + '/' + this.totalCorrectAnswers,
          'black');
    }
  },

  /**
   * Apply the BoardData to both the comments box and the board. Uses
   * glift.bridge to communicate with the display.
   */
  applyBoardData: function(boardData) {
    if (boardData) {
      this.setCommentBox(boardData.comment);
      glift.bridge.setDisplayState(
          boardData,
          this.display,
          this.sgfOptions.showVariations,
          this.sgfOptions.markLastMove);
    }
  },

  /**
   * Set the CommentBox with some specified text, if the comment box exists.
   */
  setCommentBox: function(text) {
    if (this.commentBox === undefined) {
      // Do nothing -- there is no comment box to set.
    } else if (text) {
      this.commentBox.setText(text);
    } else {
      this.commentBox.clearText();
    }
    return this;
  },

  reload: function() {
    if (this.correctness !== undefined) {
      this.correctNextSet = undefined;
      this.numCorrectAnswers = undefined;
      this.totalCorrectAnswers = undefined;
    }
    this.redraw();
  },

  /**
   * Redraw the widget.  This also resets the widget state in perhaps confusing
   * ways.
   */
  redraw: function() {
    this.destroy();
    this.draw();
  },

  destroy: function() {
    $('#' + this.wrapperDiv).empty();
    this.correctness = undefined;
    this.keyHandlerFunc !== undefined
        && $('body').unbind('keydown', this.keyHandlerFunc);
    this.keyHandlerFunc = undefined;
    this.display = undefined;
  }
}
