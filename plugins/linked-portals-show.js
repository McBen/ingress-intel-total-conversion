// @author         fstopienski
// @name           Linked portals
// @category       Portal Info
// @version        0.3.3
// @description    Try to show the linked portals (image, name and link direction) in portal detail view and jump to linked portal on click.  Some details may not be available if the linked portal is not in the current view.


// use own namespace for plugin
var showLinkedPortal = {};
window.plugin.showLinkedPortal = showLinkedPortal;

showLinkedPortal.previewOptions = {
  color: '#C33',
  opacity: 1,
  weight: 5,
  fill: false,
  dashArray: '1,6',
  radius: 18,
};

var lastPortal;

showLinkedPortal.makePortalLinkInfo = function (div,guid,data,length,is_outgoing) {
  if (div) {
    div.empty().removeClass('outOfRange');
  } else {
    div = $('<div>');
    if (guid === lastPortal) {
      div.addClass('lastportal');
    }
  }
  var lengthFull = digits(Math.round(length)) + 'm';
  var title = data && data.title;
  if (title) {
    $('<img/>').attr({
      src: fixPortalImageUrl(data.image),
      class: 'minImg',
      alt: title,
    }).appendTo(div);
  } else {
    title = 'Go to portal';
    var lengthShort = length < 100000 ? lengthFull : digits(Math.round(length/1000)) + 'km';
    div
      .addClass('outOfRange')
      .append($('<span/>').html('Portal not loaded.<br>' + lengthShort));
  }
  div.attr('title', $('<div/>')
    .append($('<strong/>').text(title))
    .append($('<br/>'))
    .append($('<span/>').text(is_outgoing ? '↴ outgoing link' : '↳ incoming link'))
    .append($('<br/>'))
    .append($('<span/>').html(lengthFull))
    .html());
  return div;
};

showLinkedPortal.portalDetail = function (data) {
  showLinkedPortal.removePreview();

  var portalLinks = getPortalLinks(data.guid);
  var length = portalLinks.in.length + portalLinks.out.length;

  var c = 1;

  $('<div>',{id:'showLinkedPortalContainer'}).appendTo('.imgpreview');

  function renderLinkedPortal(linkGuid) {
    if (c > 16) return;

    var key = this.toString(); // passed by Array.prototype.forEach
    var direction = (key === 'd' ? 'outgoing' : 'incoming');
    var link = window.links[linkGuid].options.data;
    var guid = link[key + 'Guid'];
    var lat = link[key + 'LatE6']/1E6;
    var lng = link[key + 'LngE6']/1E6;

    var length = L.latLng(link.oLatE6/1E6, link.oLngE6/1E6).distanceTo([link.dLatE6/1E6, link.dLngE6/1E6]);
    var data = (portals[guid] && portals[guid].options.data) || portalDetail.get(guid);

    showLinkedPortal.makePortalLinkInfo(null,guid,data,length,direction==='outgoing')
      .addClass('showLinkedPortalLink showLinkedPortalLink' + c + ' ' + direction)
      .attr({
        'data-guid': guid,
        'data-lat': lat,
        'data-lng': lng,
        'data-length': length,
      })
      .appendTo('#showLinkedPortalContainer');

    c++;
  }

  portalLinks.out.forEach(renderLinkedPortal, 'd');
  portalLinks.in.forEach(renderLinkedPortal, 'o');

  if (length > 16) {
    $('<div>')
      .addClass('showLinkedPortalOverflow')
      .text(length-16 + ' more')
      .appendTo('#showLinkedPortalContainer');
  }

  $('#showLinkedPortalContainer')
    .on('click', '.showLinkedPortalLink:not(".outOfRange")', showLinkedPortal.renderPortalDetails)
    .on('click', '.showLinkedPortalLink.outOfRange', showLinkedPortal.requestPortalData)
    .on('taphold', '.showLinkedPortalLink', { duration: 900 }, showLinkedPortal.showMap)
    .on('mouseover', '.showLinkedPortalLink.outOfRange', showLinkedPortal.requestPortalData)
    .on('mouseover', '.showLinkedPortalLink', showLinkedPortal.showPreview)
    .on('mouseout', '.showLinkedPortalLink', showLinkedPortal.removePreview);
};

showLinkedPortal.renderPortalDetails = function() {
  showLinkedPortal.removePreview();

  var element = $(this);
  var guid = element.attr('data-guid');
  var lat = element.attr('data-lat');
  var lng = element.attr('data-lng');

  var position = L.latLng(lat, lng);
  if (!map.getBounds().contains(position)) {
    map.setView(position);
  }
  if (portals[guid]) {
    renderPortalDetails(guid);
  } else {
    zoomToAndShowPortal(guid, position);
  }
};

showLinkedPortal.requestPortalData = function() {
  var element = $(this);
  var guid = element.attr('data-guid');
  var length = element.attr('data-length');
  var is_outgoing = element.hasClass('outgoing');
  portalDetail.request(guid).done(function(data) {
    showLinkedPortal.makePortalLinkInfo(element,guid,data,length,is_outgoing);
    // update tooltip
    var tooltipId = element.attr('aria-describedby');
    if (tooltipId) {
      $('#' + tooltipId).html(element.attr('title'));
    }
  });
};

showLinkedPortal.showMap = function() {
  // close portal info in order to preview link on map
  if (isSmartphone()) { show('map'); }
};

showLinkedPortal.showPreview = function() {
  showLinkedPortal.removePreview();

  var element = $(this);
  var lat = element.attr('data-lat');
  var lng = element.attr('data-lng');

  var remote = L.latLng(lat, lng);
  var local = portals[selectedPortal].getLatLng();

  showLinkedPortal.preview = L.layerGroup().addTo(map);

  L.circleMarker(remote, showLinkedPortal.previewOptions)
    .addTo(showLinkedPortal.preview);

  L.geodesicPolyline([local, remote], showLinkedPortal.previewOptions)
    .addTo(showLinkedPortal.preview);
};

showLinkedPortal.removePreview = function() {
  if (showLinkedPortal.preview) {
    map.removeLayer(showLinkedPortal.preview);
  }
  showLinkedPortal.preview = null;
};

function setup () {
  window.addHook('portalSelected', function (data) {
    var sel = data.selectedPortalGuid;
    var unsel = data.unselectedPortalGuid;
    lastPortal = sel !== unsel ? unsel : lastPortal;
  });

  window.addHook('portalDetailsUpdated', showLinkedPortal.portalDetail);
  $('<style>').prop('type', 'text/css').html('@include_string:linked-portals-show.css@').appendTo('head');
}
/* exported setup */
