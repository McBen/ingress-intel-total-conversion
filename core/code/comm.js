/**
 * Namespace for comm-related functionalities.
 *
 * @memberof IITC
 * @namespace comm
 */

/**
 * @type {chat.ChannelDescription[]}
 */
var _channels = [
  {
    id: 'all',
    name: 'All',
    localBounds: true,
    inputPrompt: 'broadcast:',
    inputClass: 'public',
    request: requestChannel,
    render: renderChannel,
    sendMessage: sendChatMessage,
  },
  {
    id: 'faction',
    name: 'Faction',
    localBounds: true,
    inputPrompt: 'tell faction:',
    inputClass: 'faction',
    request: requestChannel,
    render: renderChannel,
    sendMessage: sendChatMessage,
  },
  {
    id: 'alerts',
    name: 'Alerts',
    inputPrompt: 'tell Jarvis:',
    inputClass: 'alerts',
    request: requestChannel,
    render: renderChannel,
    sendMessage: function () {
      alert("Jarvis: A strange game. The only winning move is not to play. How about a nice game of chess?\n(You can't comm to the 'alerts' channel!)");
    },
  },
];

/**
 * Holds data related to each intel channel.
 *
 * @type {Object}
 */
var _channelsData = {};

/**
 * Initialize the channel data.
 *
 * @function IITC.comm._initChannelData
 * @private
 * @param {chat.ChannelDescription} id - The channel id.
 */
function _initChannelData(id) {
  // preserve channel object
  if (!_channelsData[id]) _channelsData[id] = {};
  _channelsData[id].data = {};
  _channelsData[id].guids = [];
  _channelsData[id].oldestTimestamp = -1;
  delete _channelsData[id].oldestGUID;
  _channelsData[id].newestTimestamp = -1;
  delete _channelsData[id].newestGUID;
}

/**
 * Updates the oldest and newest message timestamps and GUIDs in the chat storage.
 *
 * @function IITC.comm._updateOldNewHash
 * @private
 * @param {Object} newData - The new chat data received.
 * @param {Object} storageHash - The chat storage object.
 * @param {boolean} isOlderMsgs - Whether the new data contains older messages.
 * @param {boolean} isAscendingOrder - Whether the new data is in ascending order.
 */
function _updateOldNewHash(newData, storageHash, isOlderMsgs, isAscendingOrder) {
  // track oldest + newest timestamps/GUID
  if (newData.result.length > 0) {
    var first = {
      guid: newData.result[0][0],
      time: newData.result[0][1],
    };
    var last = {
      guid: newData.result[newData.result.length - 1][0],
      time: newData.result[newData.result.length - 1][1],
    };
    if (isAscendingOrder) {
      var temp = first;
      first = last;
      last = temp;
    }
    if (storageHash.oldestTimestamp === -1 || storageHash.oldestTimestamp >= last.time) {
      if (isOlderMsgs || storageHash.oldestTimestamp !== last.time) {
        storageHash.oldestTimestamp = last.time;
        storageHash.oldestGUID = last.guid;
      }
    }
    if (storageHash.newestTimestamp === -1 || storageHash.newestTimestamp <= first.time) {
      if (!isOlderMsgs || storageHash.newestTimestamp !== first.time) {
        storageHash.newestTimestamp = first.time;
        storageHash.newestGUID = first.guid;
      }
    }
  }
}

/**
 * Parses comm message data into a more convenient format.
 *
 * @function IITC.comm.parseMsgData
 * @param {Object} data - The raw comm message data.
 * @returns {Object} The parsed comm message data.
 */
function parseMsgData(data) {
  var categories = data[2].plext.categories;
  var isPublic = (categories & 1) === 1;
  var isSecure = (categories & 2) === 2;
  var msgAlert = (categories & 4) === 4;

  var msgToPlayer = msgAlert && (isPublic || isSecure);

  var time = data[1];
  var team = window.teamStringToId(data[2].plext.team);
  var auto = data[2].plext.plextType !== 'PLAYER_GENERATED';
  var systemNarrowcast = data[2].plext.plextType === 'SYSTEM_NARROWCAST';

  var markup = data[2].plext.markup;

  var player = {
    name: '',
    team: team,
  };
  markup.forEach(function (ent) {
    switch (ent[0]) {
      case 'SENDER': // user generated messages
        player.name = ent[1].plain.replace(/: $/, ''); // cut “: ” at end
        break;

      case 'PLAYER': // automatically generated messages
        player.name = ent[1].plain;
        player.team = window.teamStringToId(ent[1].team);
        break;

      default:
        break;
    }
  });

  return {
    guid: data[0],
    time: time,
    public: isPublic,
    secure: isSecure,
    alert: msgAlert,
    msgToPlayer: msgToPlayer,
    type: data[2].plext.plextType,
    narrowcast: systemNarrowcast,
    auto: auto,
    team: team,
    player: player,
    markup: markup,
  };
}

/**
 * Writes new chat data to the chat storage and manages the order of messages.
 *
 * @function IITC.comm._writeDataToHash
 * @private
 * @param {Object} newData - The new chat data received.
 * @param {Object} storageHash - The chat storage object.
 * @param {boolean} isOlderMsgs - Whether the new data contains older messages.
 * @param {boolean} isAscendingOrder - Whether the new data is in ascending order.
 */
function _writeDataToHash(newData, storageHash, isOlderMsgs, isAscendingOrder) {
  _updateOldNewHash(newData, storageHash, isOlderMsgs, isAscendingOrder);

  newData.result.forEach(function (json) {
    // avoid duplicates
    if (json[0] in storageHash.data) {
      return true;
    }

    var parsedData = IITC.comm.parseMsgData(json);

    // format: timestamp, autogenerated, HTML message, nick, additional data (parsed, plugin specific data...)
    storageHash.data[parsedData.guid] = [parsedData.time, parsedData.auto, IITC.comm.renderMsgRow(parsedData), parsedData.player.name, parsedData];
    if (isAscendingOrder) {
      storageHash.guids.push(parsedData.guid);
    } else {
      storageHash.guids.unshift(parsedData.guid);
    }
  });
}

/**
 * Posts a chat message to intel comm context.
 *
 * @function IITC.comm.sendChatMessage
 * @param {string} tab intel tab name (either all or faction)
 * @param {string} msg message to be sent
 */
function sendChatMessage(tab, msg) {
  if (tab !== 'all' && tab !== 'faction') return;

  var latlng = map.getCenter();

  var data = {
    message: msg,
    latE6: Math.round(latlng.lat * 1e6),
    lngE6: Math.round(latlng.lng * 1e6),
    tab: tab,
  };

  var errMsg = 'Your message could not be delivered. You can copy&' + 'paste it here and try again if you want:\n\n' + msg;

  window.postAjax(
    'sendPlext',
    data,
    function (response) {
      if (response.error) alert(errMsg);
      window.startRefreshTimeout(0.1 * 1000); // only comm uses the refresh timer stuff, so a perfect way of forcing an early refresh after a send message
    },
    function () {
      alert(errMsg);
    }
  );
}

var _oldBBox = null;
/**
 * Generates post data for chat requests.
 *
 * @function IITC.comm._genPostData
 * @private
 * @param {string} channel - The chat channel.
 * @param {boolean} getOlderMsgs - Flag to determine if older messages are being requested.
 * @returns {Object} The generated post data.
 */
function _genPostData(channel, getOlderMsgs) {
  if (typeof channel !== 'string') {
    throw new Error('API changed: isFaction flag now a channel string - all, faction, alerts');
  }

  var b = window.clampLatLngBounds(map.getBounds());

  // set a current bounding box if none set so far
  if (!_oldBBox) _oldBBox = b;

  // to avoid unnecessary comm refreshes, a small difference compared to the previous bounding box
  // is not considered different
  var CHAT_BOUNDINGBOX_SAME_FACTOR = 0.1;
  // if the old and new box contain each other, after expanding by the factor, don't reset comm
  if (!(b.pad(CHAT_BOUNDINGBOX_SAME_FACTOR).contains(_oldBBox) && _oldBBox.pad(CHAT_BOUNDINGBOX_SAME_FACTOR).contains(b))) {
    log.log('Bounding Box changed, comm will be cleared (old: ' + _oldBBox.toBBoxString() + '; new: ' + b.toBBoxString() + ')');

    // need to reset these flags now because clearing will only occur
    // after the request is finished – i.e. there would be one almost
    // useless request.
    _channels.forEach(function (entry) {
      if (entry.localBounds) {
        _initChannelData(entry.id);
        $('#chat' + entry.id).data('needsClearing', true);
      }
    });
    _oldBBox = b;
  }

  if (!_channelsData[channel]) _initChannelData(channel);
  var storageHash = _channelsData[channel];

  var ne = b.getNorthEast();
  var sw = b.getSouthWest();
  var data = {
    minLatE6: Math.round(sw.lat * 1e6),
    minLngE6: Math.round(sw.lng * 1e6),
    maxLatE6: Math.round(ne.lat * 1e6),
    maxLngE6: Math.round(ne.lng * 1e6),
    minTimestampMs: -1,
    maxTimestampMs: -1,
    tab: channel,
  };

  if (getOlderMsgs) {
    // ask for older comm when scrolling up
    data = $.extend(data, {
      maxTimestampMs: storageHash.oldestTimestamp,
      plextContinuationGuid: storageHash.oldestGUID,
    });
  } else {
    // ask for newer comm
    var min = storageHash.newestTimestamp;
    // the initial request will have both timestamp values set to -1,
    // thus we receive the newest 50. After that, we will only receive
    // messages with a timestamp greater or equal to min above.
    // After resuming from idle, there might be more new messages than
    // desiredNumItems. So on the first request, we are not really up to
    // date. We will eventually catch up, as long as there are less new
    // messages than 50 per each refresh cycle.
    // A proper solution would be to query until no more new results are
    // returned.
    // Currently this edge case is not handled. Let’s see if this is a
    // problem in crowded areas.
    $.extend(data, {
      minTimestampMs: min,
      plextContinuationGuid: storageHash.newestGUID,
    });
    // when requesting with an actual minimum timestamp, request oldest rather than newest first.
    // this matches the stock intel site, and ensures no gaps when continuing after an extended idle period
    if (min > -1) $.extend(data, { ascendingTimestampOrder: true });
  }
  return data;
}

var _requestRunning = {};

/**
 * Requests chat messages.
 *
 * @function IITC.comm.requestChannel
 * @param {string} channel - Comm Intel channel (all/faction/alerts)
 * @param {boolean} getOlderMsgs - Flag to determine if older messages are being requested.
 * @param {boolean} [isRetry=false] - Flag to indicate if this is a retry attempt.
 */
function requestChannel(channel, getOlderMsgs, isRetry) {
  if (_requestRunning[channel] && !isRetry) return;
  if (window.isIdle()) return window.renderUpdateStatus();
  _requestRunning[channel] = true;
  $("#chatcontrols a[data-channel='" + channel + "']").addClass('loading');

  var d = _genPostData(channel, getOlderMsgs);
  window.postAjax(
    'getPlexts',
    d,
    function (data) {
      _handleChannel(channel, data, getOlderMsgs, d.ascendingTimestampOrder);
    },
    isRetry
      ? function () {
          _requestRunning[channel] = false;
        }
      : function (_, textStatus) {
          if (textStatus === 'abort') _requestRunning[channel] = false;
          else requestChannel(channel, getOlderMsgs, true);
        }
  );
}

/**
 * Handles faction chat response.
 *
 * @function IITC.comm._handleChannel
 * @private
 * @param {string} channel - Comm Intel channel (all/faction/alerts)
 * @param {Object} data - Response data from server.
 * @param {boolean} olderMsgs - Indicates if older messages were requested.
 * @param {boolean} ascendingTimestampOrder - Indicates if messages are in ascending timestamp order.
 */
function _handleChannel(channel, data, olderMsgs, ascendingTimestampOrder) {
  _requestRunning[channel] = false;
  $("#chatcontrols a[data-channel='" + channel + "']").removeClass('loading');

  if (!data || !data.result) {
    window.failedRequestCount++;
    return log.warn(channel + ' comm error. Waiting for next auto-refresh.');
  }

  if (!data.result.length && !$('#chat' + channel).data('needsClearing')) {
    // no new data and current data in comm._faction.data is already rendered
    return;
  }

  $('#chat' + channel).data('needsClearing', null);

  if (!_channelsData[channel]) _initChannelData(channel);
  var old = _channelsData[channel].oldestGUID;
  _writeDataToHash(data, _channelsData[channel], olderMsgs, ascendingTimestampOrder);
  var oldMsgsWereAdded = old !== _channelsData[channel].oldestGUID;

  var hook = channel + 'ChatDataAvailable';
  // backward compability
  if (channel === 'all') hook = 'publicChatDataAvailable';
  window.runHooks(hook, { raw: data, result: data.result, processed: _channelsData[channel].data });

  // generic hook
  window.runHooks('commDataAvailable', { channel: channel, raw: data, result: data.result, processed: _channelsData[channel].data });

  renderChannel(channel, oldMsgsWereAdded);
}

/**
 * Renders intel chat.
 *
 * @function IITC.comm.renderChannel
 * @param {string} channel - Comm Intel channel (all/faction/alerts)
 * @param {boolean} oldMsgsWereAdded - Indicates if old messages were added in the current rendering.
 */
function renderChannel(channel, oldMsgsWereAdded) {
  if (!_channelsData[channel]) _initChannelData(channel);
  IITC.comm.renderData(_channelsData[channel].data, 'chat' + channel, oldMsgsWereAdded, _channelsData[channel].guids);
}

//
// Rendering primitive for markup, chat cells (td) and chat row (tr)
//

/**
 * Renders text for the chat, converting plain text to HTML and adding links.
 *
 * @function IITC.comm.renderText
 * @param {Object} text - An object containing the plain text to render.
 * @returns {string} The rendered HTML string.
 */
function renderText(text) {
  let content;

  if (text.team) {
    let teamId = window.teamStringToId(text.team);
    if (teamId === window.TEAM_NONE) teamId = window.TEAM_MAC;
    const spanClass = window.TEAM_TO_CSS[teamId];
    content = $('<div>').append($('<span>', { class: spanClass, text: text.plain }));
  } else {
    content = $('<div>').text(text.plain);
  }

  return content.html().autoLink();
}

/**
 * Overrides portal names used repeatedly in chat, such as 'US Post Office', with more specific names.
 *
 * @function IITC.comm.getChatPortalName
 * @param {Object} markup - An object containing portal markup, including the name and address.
 * @returns {string} The processed portal name.
 */
function getChatPortalName(markup) {
  var name = markup.name;
  if (name === 'US Post Office') {
    var address = markup.address.split(',');
    name = 'USPS: ' + address[0];
  }
  return name;
}

/**
 * Renders a portal link for use in the chat.
 *
 * @function IITC.comm.renderPortal
 * @param {Object} portal - The portal data.
 * @returns {string} HTML string of the portal link.
 */
function renderPortal(portal) {
  var lat = portal.latE6 / 1e6,
    lng = portal.lngE6 / 1e6;
  var perma = window.makePermalink([lat, lng]);
  var js = 'window.selectPortalByLatLng(' + lat + ', ' + lng + ');return false';
  return '<a onclick="' + js + '"' + ' title="' + portal.address + '"' + ' href="' + perma + '" class="help">' + IITC.comm.getChatPortalName(portal) + '</a>';
}

/**
 * Renders a faction entity for use in the chat.
 *
 * @function IITC.comm.renderFactionEnt
 * @param {Object} faction - The faction data.
 * @returns {string} HTML string representing the faction.
 */
function renderFactionEnt(faction) {
  var teamId = window.teamStringToId(faction.team);
  var name = window.TEAM_NAMES[teamId];
  var spanClass = window.TEAM_TO_CSS[teamId];
  return $('<div>').html($('<span>').attr('class', spanClass).text(name)).html();
}

/**
 * Renders a player's nickname in chat.
 *
 * @function IITC.comm.renderPlayer
 * @param {Object} player - The player object containing nickname and team.
 * @param {boolean} at - Whether to prepend '@' to the nickname.
 * @param {boolean} sender - Whether the player is the sender of a message.
 * @returns {string} The HTML string representing the player's nickname in chat.
 */
function renderPlayer(player, at, sender) {
  var name = player.plain;
  if (sender) {
    name = player.plain.replace(/: $/, '');
  } else if (at) {
    name = player.plain.replace(/^@/, '');
  }
  var thisToPlayer = name === window.PLAYER.nickname;
  var spanClass = 'nickname ' + (thisToPlayer ? 'pl_nudge_me' : player.team + ' pl_nudge_player');
  return $('<div>')
    .html(
      $('<span>')
        .attr('class', spanClass)
        .text((at ? '@' : '') + name)
    )
    .html();
}

/**
 * Renders a chat message entity based on its type.
 *
 * @function IITC.comm.renderMarkupEntity
 * @param {Array} ent - The entity array, where the first element is the type and the second element is the data.
 * @returns {string} The HTML string representing the chat message entity.
 */
function renderMarkupEntity(ent) {
  switch (ent[0]) {
    case 'TEXT':
      return IITC.comm.renderText(ent[1]);
    case 'PORTAL':
      return IITC.comm.renderPortal(ent[1]);
    case 'FACTION':
      return IITC.comm.renderFactionEnt(ent[1]);
    case 'SENDER':
      return IITC.comm.renderPlayer(ent[1], false, true);
    case 'PLAYER':
      return IITC.comm.renderPlayer(ent[1]);
    case 'AT_PLAYER':
      return IITC.comm.renderPlayer(ent[1], true);
    default:
  }
  return $('<div>')
    .text(ent[0] + ':<' + ent[1].plain + '>')
    .html();
}

/**
 * Renders the markup of a chat message, converting special entities like player names, portals, etc., into HTML.
 *
 * @function IITC.comm.renderMarkup
 * @param {Array} markup - The markup array of a chat message.
 * @returns {string} The HTML string representing the complete rendered chat message.
 */
function renderMarkup(markup) {
  var msg = '';

  markup.forEach(function (ent, ind) {
    switch (ent[0]) {
      case 'SENDER':
      case 'SECURE':
        // skip as already handled
        break;

      case 'PLAYER': // automatically generated messages
        if (ind > 0) msg += IITC.comm.renderMarkupEntity(ent); // don’t repeat nick directly
        break;

      default:
        // add other enitities whatever the type
        msg += IITC.comm.renderMarkupEntity(ent);
        break;
    }
  });
  return msg;
}

/**
 * Transforms a the markup array into an older, more straightforward format for easier understanding.
 *
 * May be used to build an entirely new markup to be rendered without altering the original one.
 *
 * @function IITC.comm.transformMessage
 * @param {Object} data - The data for the message, including time, player, and message content.
 * @returns {Array} The transformed markup array with a simplified structure.
 */
function transformMessage(data) {
  // Make a copy of the markup array to avoid modifying the original input
  let newMarkup = JSON.parse(JSON.stringify(data.markup));

  // Collapse <faction> + "Link"/"Field". Example: "Agent <player> destroyed the <faction> Link ..."
  if (newMarkup.length > 4) {
    if (newMarkup[3][0] === 'FACTION' && newMarkup[4][0] === 'TEXT' && (newMarkup[4][1].plain === ' Link ' || newMarkup[4][1].plain === ' Control Field @')) {
      newMarkup[4][1].team = newMarkup[3][1].team;
      newMarkup.splice(3, 1);
    }
  }

  // Skip "Agent <player>" at the beginning
  if (newMarkup.length > 1) {
    if (newMarkup[0][0] === 'TEXT' && newMarkup[0][1].plain === 'Agent ' && newMarkup[1][0] === 'PLAYER') {
      newMarkup.splice(0, 2);
    }
  }

  // Skip "<faction> agent <player>" at the beginning
  if (newMarkup.length > 2) {
    if (newMarkup[0][0] === 'FACTION' && newMarkup[1][0] === 'TEXT' && newMarkup[1][1].plain === ' agent ' && newMarkup[2][0] === 'PLAYER') {
      newMarkup.splice(0, 3);
    }
  }

  return newMarkup;
}

/**
 * Renders a cell in the chat table to display the time a message was sent.
 * Formats the time and adds it to a <time> HTML element with a tooltip showing the full date and time.
 *
 * @function IITC.comm.renderTimeCell
 * @param {number} time - The timestamp of the message.
 * @param {string} classNames - Additional class names to be added to the time cell.
 * @returns {string} The HTML string representing a table cell with the formatted time.
 */
function renderTimeCell(time, classNames) {
  const ta = window.unixTimeToHHmm(time);
  let tb = window.unixTimeToDateTimeString(time, true);
  // add <small> tags around the milliseconds
  tb = (tb.slice(0, 19) + '<small class="milliseconds">' + tb.slice(19) + '</small>').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return '<td><time class="' + classNames + '" title="' + tb + '" data-timestamp="' + time + '">' + ta + '</time></td>';
}

/**
 * Renders a cell in the chat table for a player's nickname.
 * Wraps the nickname in <mark> HTML element for highlighting.
 *
 * @function IITC.comm.renderNickCell
 * @param {string} nick - The nickname of the player.
 * @param {string} classNames - Additional class names to be added to the nickname cell.
 * @returns {string} The HTML string representing a table cell with the player's nickname.
 */
function renderNickCell(nick, classNames) {
  const i = ['<span class="invisep">&lt;</span>', '<span class="invisep">&gt;</span>'];
  return '<td>' + i[0] + '<mark class="' + classNames + '">' + nick + '</mark>' + i[1] + '</td>';
}

/**
 * Renders a cell in the chat table for a chat message.
 * The message is inserted as inner HTML of the table cell.
 *
 * @function IITC.comm.renderMsgCell
 * @param {string} msg - The chat message to be displayed.
 * @param {string} classNames - Additional class names to be added to the message cell.
 * @returns {string} The HTML string representing a table cell with the chat message.
 */
function renderMsgCell(msg, classNames) {
  return '<td class="' + classNames + '">' + msg + '</td>';
}

/**
 * Renders a row for a chat message including time, nickname, and message cells.
 *
 * @function IITC.comm.renderMsgRow
 * @param {Object} data - The data for the message, including time, player, and message content.
 * @returns {string} The HTML string representing a row in the chat table.
 */
function renderMsgRow(data) {
  var timeClass = data.msgToPlayer ? 'pl_nudge_date' : '';
  var timeCell = IITC.comm.renderTimeCell(data.time, timeClass);

  var nickClasses = ['nickname'];
  if (data.player.team === window.TEAM_ENL || data.player.team === window.TEAM_RES) {
    nickClasses.push(window.TEAM_TO_CSS[data.player.team]);
  }
  // highlight things said/done by the player in a unique colour
  // (similar to @player mentions from others in the chat text itself)
  if (data.player.name === window.PLAYER.nickname) {
    nickClasses.push('pl_nudge_me');
  }
  var nickCell = IITC.comm.renderNickCell(data.player.name, nickClasses.join(' '));

  const markup = IITC.comm.transformMessage(data);
  var msg = IITC.comm.renderMarkup(markup);
  var msgClass = data.narrowcast ? 'system_narrowcast' : '';
  var msgCell = IITC.comm.renderMsgCell(msg, msgClass);

  var className = '';
  if (!data.auto && data.public) {
    className = 'public';
  } else if (!data.auto && data.secure) {
    className = 'faction';
  }
  return '<tr data-guid="' + data.guid + '" class="' + className + '">' + timeCell + nickCell + msgCell + '</tr>';
}

/**
 * Renders a divider row in the chat table.
 *
 * @function IITC.comm.renderDivider
 * @param {string} text - Text to display within the divider row.
 * @returns {string} The HTML string representing a divider row in the chat table.
 */
function renderDivider(text) {
  return '<tr class="divider"><td><hr></td><td>' + text + '</td><td><hr></td></tr>';
}

/**
 * Renders data from the data-hash to the element defined by the given ID.
 *
 * @function IITC.comm.renderData
 * @param {Object} data - Chat data to be rendered.
 * @param {string} element - ID of the DOM element to render the chat into.
 * @param {boolean} likelyWereOldMsgs - Flag indicating if older messages are likely to have been added.
 * @param {Array} sortedGuids - Sorted array of GUIDs representing the order of messages.
 */
function renderData(data, element, likelyWereOldMsgs, sortedGuids) {
  var elm = $('#' + element);
  if (elm.is(':hidden')) {
    return;
  }

  // if sortedGuids is not specified (legacy), sort old to new
  // (disregarding server order)
  var vals = sortedGuids;
  if (vals === undefined) {
    vals = $.map(data, function (v, k) {
      return [[v[0], k]];
    });
    vals = vals.sort(function (a, b) {
      return a[0] - b[0];
    });
    vals = vals.map(function (v) {
      return v[1];
    });
  }

  // render to string with date separators inserted
  var msgs = '';
  var prevTime = null;
  vals.forEach(function (guid) {
    var msg = data[guid];
    var nextTime = new Date(msg[0]).toLocaleDateString();
    if (prevTime && prevTime !== nextTime) {
      msgs += IITC.comm.renderDivider(nextTime);
    }
    msgs += msg[2];
    prevTime = nextTime;
  });

  var firstRender = elm.is(':empty');
  var scrollBefore = window.scrollBottom(elm);
  elm.html('<table>' + msgs + '</table>');

  if (firstRender) {
    elm.data('needsScrollTop', 99999999);
  } else {
    chat.keepScrollPosition(elm, scrollBefore, likelyWereOldMsgs);
  }

  if (elm.data('needsScrollTop')) {
    elm.data('ignoreNextScroll', true);
    elm.scrollTop(elm.data('needsScrollTop'));
    elm.data('needsScrollTop', null);
  }
}

for (const channel of _channels) {
  _initChannelData(channel.id);
}

IITC.comm = {
  channels: _channels,
  sendChatMessage,
  parseMsgData,
  // Render primitive, may be override
  renderMsgRow,
  renderDivider,
  renderTimeCell,
  renderNickCell,
  renderMsgCell,
  renderMarkup,
  transformMessage,
  renderMarkupEntity,
  renderPlayer,
  renderFactionEnt,
  renderPortal,
  renderText,
  getChatPortalName,
  // exposed API for legacy
  requestChannel,
  renderChannel,
  renderData,
  _channelsData,
};

/* global log, map, chat, IITC */