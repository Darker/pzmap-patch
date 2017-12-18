// ==UserScript==
// @name        Project Zomboid Map Patch
// @namespace   pz
// @include     /^https?://(www\.)?pzmap.crash\-override\.net.*?/
// @version     1
// @grant       none
// @unwrap
// ==/UserScript==

var viewer;
var areas = [];
var overlays = [];
var privateOverlays = [];
var height = 7800;
var tileWidth = 64;
var tileHeight = 32;
var ratio = 2; // tileWidth / tileHeight;
var pixelToTileOffsetX = 0;
var pixelToTileOffsetY = 0;
var tileToPixelOffsetX = 0;
var tileToPixelOffsetY = 0;
var currentLevel = 0;

/**
 * Reads get params into javascript object and returns that object. Doesn't work on indexed params (eg ?d[xxx]=xxx)
**/
function populateGet() {{{
  var obj = {}, params = location.search.slice(1).split('&');
  for(var i=0,len=params.length;i<len;i++) {
    var keyVal = params[i].split('=');
    obj[decodeURIComponent(keyVal[0])] = decodeURIComponent(keyVal[1]);
  }
  return obj;
}}}
var _GET = populateGet();

// Detect debug mode
var DEBUG = false;
if (_GET["DEBUG"] != undefined){
  DEBUG = parseInt(_GET["DEBUG"]) == 1;
}

//NOTE: there's an "official" polyfill: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/keys#Polyfill
if(!Object.keys) Object.keys = function(o){{{
  //NOTE: I think this is sub optimal way to check an object
  if (o !== Object(o))
    throw new TypeError('Object.keys called on non-object');
  var ret=[],
      p;
  for(p in o)
    if(Object.prototype.hasOwnProperty.call(o,p))
      ret.push(p);
  return ret;
}}}

window.onresize = function(){{{
  if ($(".sidebar").css("display") == "none"){
    $("#map").width($(window).width());
  } else {
    $("#map").width($(window).width()-$(".sidebar").width());
  }
  if ($("#footer").css("display") == "none"){
    $("#map").height($(window).height()-$(".main").position().top);
  } else {
    $("#map").height($(window).height()-$(".main").position().top-$("#footer").height());
  }
}}}

function circleSize() {{{
/*  if (!viewer)
    return "medium";
  if (!viewer.drawer)
    return "medium";
  var tile = viewer.drawer.lastDrawn;
  if (!tile.length){
    return "small";
  }

  var zoom = tile[0].level;
  if (zoom >= 15){
    return "large";
  }
  if (zoom >= 14){
    return "medium";
  }           */
  return "small";
}}}

function addOverlayFromConfiguration( drawer, overlay ) {{{
  /* Taken verbatim from OpenSeaDragon.js */
  var element  = null;
            
  var id = overlay.id ? 
        overlay.id :
        "overlay-"+Math.floor(Math.random()*10000000);

  element = OpenSeadragon.getElement(overlay.id);
  // Create void element if no element was given
  if( !element ){
    element         = document.createElement("a");
    element.href    = "#/overlay/"+id;
    element.id      = id;
  }
  
  OpenSeadragon.addClass( element, overlay.className ?
      overlay.className :
      "openseadragon-overlay"
  );


  // recalculates px,py (the map pixel) or z,y (OpenSeadragon coordinate) to proper format
  var rect = calculatePOICoordiates(overlay, drawer);
  
  var options = { 
    element: element, 
    location: rect
  }
  
  // Placement stuff
  if(overlay.placement) {
    if(OpenSeadragon.OverlayPlacement[overlay.placement.toUpperCase()]==null)
      console.warn("Invalid placement: ", overlay.placement);
    options.placement = OpenSeadragon.OverlayPlacement[overlay.placement.toUpperCase()];
    options.location = drawer.viewport.pointFromPixel(options.location);
  }
  // Special draw callback for centered elements 
  if(typeof overlay.onDraw == "function") {
    options.onDraw = overlay.onDraw;
  }
  var theOverlay = new OpenSeadragon.Overlay(options);
  
  // Allows to add aditional properties 
  if(overlay.properties !=null) {
     //console.log("Adding properties for poi.");
     for(var i in overlay.properties) {
       if(overlay.properties.hasOwnProperty(i)) {
         theOverlay[i] = overlay.properties[i];
       }
     }
  }
  else {
    //console.log("No poi properties.");
  }
  /*if(element.className.baseVal.indexOf("coords-poi")!=-1) {
    console.log("Creating POI:", theOverlay, options);
  }*/
  return theOverlay; 


}}}
// Callback for drawing objct centered around it's position
OpenSeadragon.DrawCenteredCallback = function(position, size, element ) {
  var rect = element.getBoundingClientRect();
  var style = element.style;
  style.left     = (position.x-rect.width/2) + "px";
  style.top      = (position.y-rect.height/2) + "px";

  style.position = "absolute";

  if (style.display != 'none') {
    style.display  = 'block';
  }

  if ( this.scales ) {
    style.width  = size.x + "px";
    style.height = size.y + "px";
  }
}
/**
 * This callbacks requires @point property to be set in this format:
 *   this.percent = {x: 10 or "10%", y: 10 or "10%"} **/
OpenSeadragon.DrawCenteredOnRelativePosition = function(position, size, element ) {
  // Use size for scaling elements (those that are pinned to the map)
  var rect = this.scales?size:element.getBoundingClientRect();
  var style = element.style;
  
  // get the central point
  var point = this.center || {};
  if(this.center.x)
    style.left     = interpretPercentCoord(position.x, this.center.x)+"px";
  else 
    style.left     = (position.x-rect.width/2) + "px";
  
  if(this.center.x)
    style.top     = interpretPercentCoord(position.y, this.center.y)+"px";
  else 
    style.top     = (position.y-rect.height/2) + "px";

  style.position = "absolute";

  if (style.display != 'none') {
    style.display  = 'block';
  }
  
  if ( this.scales ) {
    style.width  = size.x + "px";
    style.height = size.y + "px";
  }

  if(this.element.className.baseVal.indexOf("coords-poi")!=-1)
    console.log(this);
  /**
   * If second argument @percent is string that ends with %, recalculates it to
   * a corrseponding ftraction of @size **/
  function interpretPercentCoord(size, percent) {
    if(typeof percent=="string") {
      var pos = percent.indexOf("%");
      if(pos!=-1) {
        percent = size*(percent.substr(0,pos)*1)/100;
      }
    }
    return percent;
  }
}




function jAlert(text, closeCallback, _parent) {{{
  return $( "<div/>" ).dialog({ dialogClass: "alert", position: {my: "center", at: "center", of: _parent ? _parent : "body" }, modal: true, title: "Alert!",
    width: "95%", 
    appendTo: _parent ? _parent : "body",
    buttons: [{
      text: "Ok",
      click: function() { $(this).dialog("close"); if (closeCallback){ closeCallback(); } }
    }]
  }).html(text);
}}}
function jNotice(text, closeCallback, _parent){{{
  return $( "<div/>" ).dialog({ dialogClass: "notice", position: {my: "left top", at: "left top", of: _parent ? _parent : "body" }, title: "Notice!",
    width: "50%",
    appendTo: _parent ? _parent : "body",
    close: function(){ if (closeCallback){ closeCallback(); } }
  }).html(text);
}}}

function updateMapCircles(){{{
  var newSize = circleSize();
  $.each($("img.poi"), function(k,v){
    v=$(v);
    v.prop("src", v.prop("src").replace(/(small|medium|large)/, circleSize()));
    v.removeClass("offsetsmall offsetmedium offsetlarge").addClass("offset"+newSize);
  });
}}}

function updateLink(data) {{{
  if (!viewer.viewport) return;

  var center = viewer.viewport.getCenter();
  var zoom = viewer.viewport.getZoom();

  var link = center.x + "," + center.y + "," + zoom;
  location.hash = link;

  updateMapCircles();
}}}

function changePositionByLink(event) {{{
  var x, y, zoom;
  var m = location.hash.match(/^#([\d.]+),([\d.]+)(?:,([\d.]+))?$/);
  if (!m) {
    m = location.hash.match(/^#([a-zA-Z].*)$/);
    if (!m) {
      m = location.hash.match(/^#([0-9]*)x([0-9]*)$/);
      if (!m) {
        viewer.addHandler("animation-finish", updateLink);
        return false;
      }
      updateCoordsHTML({x: m[1], y: m[2]});
      lockCoordsAtTile(m[1], m[2]);
      var o = tileToPixel(m[1], m[2]);
      x = o.x;
      y = o.y;
      zoom = 128;
      var point = viewer.viewport.imageToViewportCoordinates(x, y);
      x = point.x;
      y = point.y;

      var point = new OpenSeadragon.Point(x, y);
      viewer.viewport.panTo(point, true);
      viewer.viewport.zoomTo(zoom, null, true);

      viewer.addHandler("animation-finish", updateLink);
      return true;
    } else {
      m[1] = m[1].toLowerCase();
      var o = [];
      for (idx in overlays){
        var r = overlays[idx];
        if (new RegExp("^overlay-"+m[1]).test(r.id)){
          o.push(r);
        }
      }
    }
    if (o.length <= 0){
      viewer.addHandler("animation-finish", updateLink);
      return false;
    }
    x = o[0].px;
    y = o[0].py;
    var point = viewer.viewport.imageToViewportCoordinates(x, y);
    x = point.x;
    y = point.y;
    zoom = 128
  } else {
    x = parseFloat(m[1]);
    y = parseFloat(m[2]);
    zoom = m[3] ? parseFloat(m[3]) : viewer.viewport.getMaxZoom();
  }

  var point = new OpenSeadragon.Point(x, y);
  viewer.viewport.panTo(point, true);
  viewer.viewport.zoomTo(zoom, null, true);

  viewer.addHandler("animation-finish", updateLink);
  return true;
}}}

function overlayMouseOver(e){{{
  var id = this.id.replace(/^overlay-/, "");
  var tip = $('#'+id+'-tip');
  var map = $("#map");
  var tipWidth = tip.width(), //Find width of tooltip
    tipHeight = tip.height(); //Find height of tooltip


  tip.css({  top: map.position().top+20, left: map.width()/2-tipWidth/2, position: 'absolute' });
  tip.show().css({opacity: 1}); //Show tooltip
}}}

function overlayMouseOut(e){{{
  var id = this.id.replace(/^overlay-/, "");
  var tip = $('#'+id+'-tip');
  tip.hide(); //Hide tooltip
}}}
function bindtooltip(onlyThis){{{
  if (DEBUG)
    console.log("bindtooltip("+onlyThis+");");

  if ($("[id^=overlay-"+onlyThis+"]").length == 0 && overlays.length > 0){
    if (DEBUG)
      console.log("setTimeout bindtooltip("+onlyThis+") 100");
     //NOTE: This is crazy dangerous. If the node never appears, this async loop goes forever
    setTimeout(function(){ bindtooltip(onlyThis); }, 100);
    return;
  }

  var map = $("div#map");
  if (onlyThis == ""){
    if (privateOverlays.length){
      for(var i=0; i<privateOverlays.length; i++){
        if (viewer.drawer == null){
          setTimeout(function(){ bindtooltip(onlyThis); }, 100);
          return;
        }
        //map.append("<img id='"+privateOverlays[i].id+"' src='images/mapcirclered_"+circleSize()+".png' class=\"poi user-poi\">");
        map.append(makePoiImage(privateOverlays[i].id, "user-poi"));
        privateOverlays[i].placement = OpenSeadragon.OverlayPlacement.CENTER;
        privateOverlays[i].onDraw = OpenSeadragon.DrawCenteredCallback;
        viewer.currentOverlays.push(addOverlayFromConfiguration(viewer.drawer, privateOverlays[i]));
      }
      setTimeout(function(){ bindtooltip("private"); }, 100);
    }
  }

  var tmpOverlays = overlays.slice(0).concat(privateOverlays);
  var selPOI = $("#selPOI");

  $.each(tmpOverlays, function(k, o){
    var id = o.id.replace(/^overlay-/, "")+"-tip";
    if (!(new RegExp("^"+onlyThis).test(id))){
      return true; // continue
    }
    if ($("#"+id).length){
      return true; // continue
    }
    if (DEBUG)
      console.log("Adding "+id);
    var added = false;
    var city = o.text.split(/:/)[0];
    if (city == o.text){
      city = "Somewhere";
    }
    var label = o.text.replace(/[^:]*: /, "")
    var link = "<a href='#"+id+"'>Share POI</a>";
    var parentGroup = false;

    map.append("<div id='"+id+"' class='tooltip'><p>"+label+"</p></div>");

    if (selPOI.find("optgroup").length == 0){
      parentGroup = $("<optgroup label='"+city+"'>").appendTo(selPOI);
    } else {
      if (selPOI.find("optgroup[label='"+city+"']").length > 0){
        parentGroup = selPOI.find("optgroup[label='"+city+"']");
      } else {
        $.each(selPOI.find("optgroup"), function(k, optgroup){
          optgroup=$(optgroup);
          if (optgroup.attr("label") > city){
            parentGroup = $("<optgroup label='"+city+"'>").insertBefore(optgroup);
            return false;
          }
        });
      }
    }
    if (!parentGroup){
      parentGroup = $("<optgroup label='"+city+"'>").appendTo(selPOI);
    }
    $.each(parentGroup.find("option"), function(k, opt){
      if (opt.value == "null"){
        return true; // continue;
      }
      if (opt.text > label){
        $(opt).before("<option value='"+o.id+"'>"+label.split(/<br/)[0]+"</option>");
        added = true;
        return false; // break
      }
    });

    if (!added){
      parentGroup.append("<option value='"+o.id+"'>"+label.split(/<br/)[0]+"</option>");
    }
  });

  $.each($("[id^=overlay-"+onlyThis+"]"), function(k, div){
    div = $(div);
    var id = div.attr("id").replace(/^overlay-/, "");
    var check = $('#'+id+'-tip');
    if (!check.length){ return true; }; // continue
    div.hover(overlayMouseOver, overlayMouseOut);
  });
}}};

function togglePOI(){{{
  $("img.poi").toggleClass("hidden");
}}}

function flushPOI(){{{
  if (!confirm("Really delete all your custom (red) POIs?")){
    return;
  }
  for (var i=0; i < privateOverlays.length; i++){
    viewer.removeOverlay(privateOverlays[i].id);
    $("option[value="+privateOverlays[i].id+"]").remove();
  }
  $(".private").remove();
  privateOverlays = [];
  if (_GET["desc"]){
    $.jStorage.set("privateOverlays"+_GET["desc"], privateOverlays);
  } else {
    $.jStorage.set("privateOverlays", privateOverlays);
  }
}}}
function addPrivateOverlay(overlay){{{
  overlay.scales = false;
  overlay.placement = OpenSeadragon.OverlayPlacement.CENTER;
  overlay.onDraw = OpenSeadragon.DrawCenteredCallback;
  privateOverlays.push(overlay);
  if (_GET["desc"]){
    $.jStorage.set("privateOverlays"+_GET["desc"], privateOverlays);
  } else {
    $.jStorage.set("privateOverlays", privateOverlays);
  }
  //$("#map").append("<img id='private-"+overlay.id+"' src='images/mapcirclered_"+circleSize()+".png' class=\"poi user-poi\">");
  $("#map").append(makePoiImage("private-"+overlay.id,"user-poi"));
  viewer.currentOverlays.push(addOverlayFromConfiguration(viewer.drawer, overlay));
  //viewer.drawer.updateAgain = true;
  bindtooltip("private-"+overlay.id);
}}}

function addPOI() {{{
  var notice = jNotice("Please select Point Of Interest", function(){ $(".addPOI").remove(); }, $("#map"));
  var divAddPOI = $("<div class='addPOI'>&nbsp;</div>").appendTo($("#map")).one("click", function(e){
    var that = this;
    var pixelTopLeft = new OpenSeadragon.Point(e.pageX-$("#map").position().left, e.pageY-$("#map").position().top);
    var pointTopLeft = viewer.viewport.pointFromPixel(pixelTopLeft);
    that.remove();
    notice.remove();
    var selectArea = "<select id='selectArea'><option value='0'>[ Please select area ]</option>";
    $.each(areas, function(k, area){
      selectArea += "<option value='"+area.id+"'>"+area.name+"</option>";
    });
    selectArea += "</select>";
    content = "<h2>Enter some description for this POI</h2>";
    content += selectArea+"<br />";
    content += "<form>";
    content += "<div class='form-group'>";
    content += "<label for='poiName'>Name of this POI:</label>";
    content += "<input type='text' id='poiName' class='form-control' placeholder='Name of POI'>";
    content += "</div>";
    content += "<div class='form-group'>";
    content += "<label for='desc'>Optional longer description:</label>";
    content += "<textarea class='form-control' id='desc' placeholder='Optional longer description'></textarea>";
    content += "</div>";
    content += "<div class='form-group'>";
    content += "<label for='chkboxSubmit'>Submit POI to official map?</label>";
    content += "<input type='checkbox' id='chkboxSubmit'>";
    content += "</div>";
    content += "</form>";
    notice = jNotice(content+"<b>PLEASE DO NOT SUBMIT MAP BUGS HERE! DO THAT <a href='http://theindiestone.com/forums/index.php/topic/3659-map-specific-problems/'>THERE INSTEAD</a>!</b><br />Also, please do <b>not</b> submit every MP spawn point, toolshed, outhouse, 'loot' or other small building. POI means 'Point of Interest' and should stay that way.", null, $("#map"));
    notice.dialog("option", "buttons",
      [{
        text: "Submit POI",
        click: function(){{{
          var area = false;
          $.each(areas, function(k, v){
            if (v.id == notice.find("#selectArea :selected").val()){
              area = v;
            }
          });
          if (!area){
            alert("You must select an area!");
            return;
          }
          var id = Math.floor(Math.random()*10000000);
          // man comeon, this is plain crazy! Using global iterated variable would be way less crazy
          while ($("#overlay-private-"+id).length){
            id = Math.floor(Math.random()*10000000);
          }
          var that = this;
          var px = Math.round(pointTopLeft.x*viewer.viewport.contentSize.x);
          var py = Math.round(pointTopLeft.y*viewer.viewport.contentSize.y*viewer.viewport.contentAspectX);
          var tilecoords = pixelToTile(px, py);
          var coords = tileToPixel(tilecoords.x, tilecoords.y);
          var desc = area.name+": "+notice.find("#poiName").val()+"\n"+notice.find("#desc").val();
          var overlay = {
            px: coords.x,
            py: coords.y + (tileHeight / 2),
            className: "highlight private",
            text: desc.replace(/\n/g, "<br />"),
            id: "overlay-private-"+id,
            onDraw: OpenSeadragon.DrawCenteredCallback
          };

          if ($("input#chkboxSubmit").prop("checked")){
            $.ajax({
              url: area.url,
              type: "POST",
              dataType: "json",
              data: {
                poi: {
                  x: tilecoords.x,
                  y: tilecoords.y,
                  name: notice.find("#poiName").val(),
                  comment: notice.find("#desc").val()
                }
              },
              success: function(){
                notice.remove();
                addPrivateOverlay(overlay);
                jNotice("<h2>Success!</h2>Your POI has been submitted for inclusion in the official POIs (blue dots). Until then, it will remain in your personal POIs (red dots).", undefined, $("#map"));
              },
              error: function(){
                jAlert("<h2>Error!</h2>You are not logged in to the <a href='/POI/' target='_blank'>POI Manager</a>. Please log in here first and then try again:<br /><a href='/POI' target='_blank'>pzmap.crash-override.net/POI</a>", undefined, $("#map"));
              }
            });
          } else {
            notice.remove();
            addPrivateOverlay(overlay);
          }
        }}}
      }]
  );
  });
}}}
function zoomToPOI(){{{
  var id=$("#selPOI :selected").attr("value");
  if (id == "null"){
    return;
  }
  var x, y;
  if (/^overlay-private-/.test(id)){
    for (var i=0; i<privateOverlays.length; i++){
      if (privateOverlays[i].id == id){
        x = privateOverlays[i].x + (privateOverlays[i].width / 2);
        y = privateOverlays[i].y + (privateOverlays[i].height / 2);
        viewer.viewport.panTo(new OpenSeadragon.Point(x, y));
        return;
      }
    }
  }
  for (var i=0; i<overlays.length; i++){
    if (overlays[i].id == id){
      x = overlays[i].px + (overlays[i].width / 2);
      y = overlays[i].py + (overlays[i].height / 2);
      viewer.viewport.panTo(viewer.viewport.imageToViewportCoordinates(x, y));
      return;
    }
  }
}}}
function tileToViewportPixel(x, y, drawer) {{{
  var x=0, y=0;
  x = (x*32) - (y*32);
  y = (x*16) + (y*16);

  x += tileToPixelOffsetX;
  y += tileToPixelOffsetY;

  x -= pixelToTileOffsetX;
  y -= pixelToTileOffsetY;

  return drawer.viewport.imageToViewportRectangle({x:x, y:y+(tileHeight / 2)});
}}}
/** Converts game map tile offset to pixel coordinate on the map image (whole image).
 * eg. returns allways 0,0 for top-left point of the map. Use imagePixeltoCanvasPixel to
 * get the coordinate on user's screen
**/
function tileToPixel(x, y) {{{
  var retVal = {x: 0, y: 0};
  retVal.x = (x*32) - (y*32);
  retVal.y = (x*16) + (y*16);

  retVal.x += tileToPixelOffsetX;
  retVal.y += tileToPixelOffsetY;

  retVal.x -= pixelToTileOffsetX;
  retVal.y -= pixelToTileOffsetY;

  return retVal;
}}}

function pixelToTile(x, y){{{
  // var height = 0; // global variable, distinct per map
  var retVal = {x: 0, y: 0};

  x += pixelToTileOffsetX;
  y += pixelToTileOffsetY;
  x = x - (height * tileWidth / 2);
  // y -= map()->cellsPerLevel().y() * (maxLevel() - level) * tileHeight; // maxLevel() - level is always 0 for PZMap purposes
  
  var mx = y + (x / ratio);
  var my = y - (x / ratio);

  retVal.x = Math.floor(mx / tileHeight);
  retVal.y = Math.floor(my / tileHeight);
  return retVal;
}}}
/** 
 * Converts the map image coordinate (pixel) to current offset
 * on <canvas> element used for rendering **/
function imagePixeltoCanvasPixel(x, y) {
  if(x instanceof Array) {
    y = x[1];
    x = x[0];
  }
  else if(x.x != null) {
    y = x.y;
    x = x.x;
  }
  x = x/viewer.viewport.contentSize.x;
  y = y/(viewer.viewport.contentSize.y*viewer.viewport.contentAspectX);
  return viewer.viewport.pixelFromPoint(new OpenSeadragon.Point(x,y), true);
}
/** Canvas pixel offset (eg. when mouse clicking) to big map image offset (eg. middle of the stop sign) **/
function canvasPixeltoImagePixel(x, y) {
  if(x instanceof Array) {
    y = x[1];
    x = x[0];
  }
  else if(x.x != null) {
    y = x.y;
    x = x.x;
  }
  var coords = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(x,y), true);
  coords.x = Math.floor(coords.x*viewer.viewport.contentSize.x);
  coords.y = Math.floor(coords.y*viewer.viewport.contentSize.y*viewer.viewport.contentAspectX);
  return coords;
}


function calculatePOICoordiates(coords, drawer) {
  var rect = ( coords.height && coords.width ) ?
         new OpenSeadragon.Rect(
           coords.x || coords.px, 
           coords.y || coords.py, 
           coords.width, 
           coords.height
          ) 
          : 
          new OpenSeadragon.Point(
            coords.x || coords.px, 
            coords.y || coords.py
          );
  if(coords.px !== undefined) {
    //if they specified 'px' it's in pixel coordinates so
    //we need to translate to viewport coordinates
    rect = drawer.viewport.imageToViewportRectangle( rect );
  }
  return rect;
}


function updateCoords(e){{{
  if (!viewer)
    return;
  if (!viewer.viewport)
    return;
  var pixelTopLeft = new OpenSeadragon.Point(e.clientX-$("#map").position().left, e.clientY-$("#map").position().top);
  var pointTopLeft = viewer.viewport.pointFromPixel(pixelTopLeft);

  var px = Math.floor(pointTopLeft.x*viewer.viewport.contentSize.x);
  var py = Math.floor(pointTopLeft.y*viewer.viewport.contentSize.y*viewer.viewport.contentAspectX);

  var coords = pixelToTile(px, py);
  //console.log("Coords from pixel: ", pixelTopLeft, pointTopLeft, [px,py]. coords);
  updateCoordsHTML(coords);
}}}

function updateCoordsHTML(coords){{{
  $("#coords").empty().append(coords.x+"x"+coords.y).attr("href", "#"+coords.x+"x"+coords.y);
  $("#coordX").empty().append(coords.x);
  $("#coordY").empty().append(coords.y);
  $("#cellX").empty().append(Math.floor(coords.x/300));
  $("#cellY").empty().append(Math.floor(coords.y/300));
  $("#relX").empty().append(coords.x%300);
  $("#relY").empty().append(coords.y%300);

  var filename = $("#coords_filename");
  if(filename.length == 0) {
    filename = $("<li><nobr>File: <span id=\"coords_filename\"></span></li>").appendTo($("#coords").parentsUntil("li")[0].parentNode).find("#coords_filename");
    //console.log(filename);
  }
  filename.text("map_"+Math.floor(coords.x/10)+"_"+Math.floor(coords.y/10)+".bin");
}}}

function unlockCoords(){{{
  $("#btnLockCoords").one("click", lockCoords).html("Lock Coords").toggleClass("active");
  document.getElementById("map").onmousemove=updateCoords;
  // Destroy the coord lock overlays
  //var o = viewer.currentOverlays.filter((a, b) => {return $(a.element).hasClass("coords-poi")});
  var o = viewer.currentOverlays.filter((a, b) => {
    try { 
      return $(a.element)[0].className.baseVal.indexOf("coords-poi")!=-1;
    } catch(e) {
     return false;
    }
  });
  console.log(o);
  o.forEach((oo) => {oo.destroy();});
  viewer.currentOverlays.splice(viewer.currentOverlays.indexOf(o[0]), o.length);
}}}
function lockCoords() {{{
  var notice = jNotice("Please choose a tile", function(){ $(".addPOI").remove(); }, $("#map"));
  var divAddPOI = $("<div class='addPOI'>&nbsp;</div>").appendTo($("#map")).one("click", function(e) {
    $(".addPOI").remove();
    var pixelTopLeft = new OpenSeadragon.Point(e.pageX-$("#map").position().left, e.pageY-$("#map").position().top);
    var pointTopLeft = viewer.viewport.pointFromPixel(pixelTopLeft);
    var px = Math.round(pointTopLeft.x*viewer.viewport.contentSize.x);
    var py = Math.round(pointTopLeft.y*viewer.viewport.contentSize.y*viewer.viewport.contentAspectX);
    var coords = pixelToTile(px, py);

    lockCoordsAtTile(coords.x, coords.y);
    viewer.viewport.panTo(pointTopLeft);
    notice.remove();
  });
}}}
function lockCoordsAtTile(x, y) {{{
  //$("<div class='addPOI'>&nbsp;</div>").appendTo($("#map"));
  document.getElementById("map").onmousemove=undefined;
  $("#btnLockCoords").unbind("click");
  $("#btnLockCoords").one("click", unlockCoords).html("Unlock Coords").toggleClass("active");
  var coords = tileToPixel(x, y);
  console.log("Lock at tile: ", x,y);

  var overlay = {
    px: coords.x,
    py: coords.y + (tileHeight / 2),
    //className: "highlight private",
    imageClassName: "coords-poi", 
    text: "Currently locked coordinates",
    //id: "overlay-coordlock-"+new Date().getTime(),
    //scales: false,
    //placement: OpenSeadragon.OverlayPlacement.CENTER,
    // Causes the coordinates to be recalculated so that the object
    // is centered around them, rather than toutchning them with corner
    //onDraw: OpenSeadragon.DrawCenteredCallback,
    // Property
    //properties: {dd: 2}
  };
  addPoi(overlay);
  //var image = $( makePoiImage(overlay.id, "coords-poi") ).appendTo( "#map" );        
  //viewer.currentOverlays.push(addOverlayFromConfiguration(viewer.drawer, overlay));
  
  //REMOVED: Seems to have no effect - not deleted in case I was wrong
  //viewer.drawer.updateAgain = true;
}}}



function runOSD(data, status, jqxhr) {{{
  var o, d, t, e;
  o = "maps/SurvivalL0/overlays.json";
  t = "maps/SurvivalL0/map.xml";
  e = "maps/SurvivalL0/extra.json";

  if (_GET["desc"]){
    if (_GET["desc"].match(/^[A-Za-z0-9_]*$/)){
      o = "maps/"+_GET["desc"]+"/overlays.json";
      t = "maps/"+_GET["desc"]+"/map.xml";
      e = "maps/"+_GET["desc"]+"/extra.json";
      $("a[desc="+_GET["desc"]+"]").parent().addClass("active");
      $(".in").removeClass("in");
      $("a[desc="+_GET["desc"]+"]").parent().parent().parent().parent().addClass("in");
    } else {
      $("a[desc=SurvivalL0]").parent().addClass("active");
    }
  } else {
    $("a[desc=SurvivalL0]").parent().addClass("active");
  }

  $.ajax({
    url: e,
    async: false,
    dataType: 'json',
    success: function(data){
      if (data){
        height = data.height;
        pixelToTileOffsetX = data.pixelToTileOffsetX;
        pixelToTileOffsetY = data.pixelToTileOffsetY;
        tileToPixelOffsetX = data.tileToPixelOffsetX;
        tileToPixelOffsetY = data.tileToPixelOffsetY;
        document.getElementById("map").onmousemove=updateCoords;
      }
    },
    error: function(a, b, c){
      console.log(a);
      console.log(b);
      console.log(c);
    }
  });

  overlays = [];
  $.ajax({
    url: o,
    async: false,
    dataType: 'json',
    success: function(data){
      $.each(data.areas, function(k, area){
        var a = {};
        $.each(area, function(key, value){
          if (key != "poi"){
            a[key] = area[key];
          }
        });
        areas.push(a);

        $.each(area.pois, function(k, poi){
          var p = {};
          $.each(poi, function(key, value){
            p[key] = poi[key];
          });
          p.id = "overlay-"+poi.id+"-"+area.name+"-"+poi.name;
          p.id = p.id.toLowerCase().replace(/[^a-z0-9]/g, "-");
          p.text = area.name+": "+poi.name;
          if (typeof poi.comment == "string" && poi.comment.length>0){
            p.text += "<br /><br />"+poi.comment;
          }
          p.width = 0;
          p.height = 0;
          p.className = "highlight";
          var coords = tileToPixel(p.x, p.y);
          p.px = coords.x;
          p.py = coords.y;
          delete(p.x); delete(p.y);
          overlays.push(p);
        });
      });
      
    },
  });

  var map = $("#map");
  $.each(overlays, function(k,overlay){
    href=overlay.id.replace("overlay-","");
    //map.append("<a id='"+overlay.id+"' href='#"+href+"'><img src='images/mapcircleblue_"+circleSize()+".png' class=\"poi global-poi\"></a>");
    map.append("<a id='"+overlay.id+"' href='#"+href+"'>"+makePoiImage(overlay.id+"-svg", "global-poi")+"</a>");
    overlay.placement = OpenSeadragon.OverlayPlacement.CENTER;
    //overlay.onDraw = OpenSeadragon.DrawCenteredCallback;
  });

  window.viewer = viewer = OpenSeadragon({
    id: "map",
    tileSources: t,
    debugMode: DEBUG,
    overlays: overlays
  });
  viewer.addHandler('open', changePositionByLink);

  if (_GET["desc"]){
    privateOverlays = $.jStorage.get("privateOverlays"+_GET["desc"], []);
  } else {
    privateOverlays = $.jStorage.get("privateOverlays", []);
  }

  bindtooltip("");
}}}



function addLayer(data){{{
  var btn = data.data;
  var desc = btn.attr("desc");

  if (!desc.match(/^[A-Za-z0-9_]*$/)){
    console.warn("Desc didn't match ^[A-Za-z0-9_]*$");
    return;
  }
  var o = "maps/"+desc+"L0/overlays.json";
  var e = "maps/"+desc+"L0/extra.json";
  var t = "maps/"+desc+"L0/map.xml";

  $.ajax({
    url: e,
    dataType: 'json',
    success: function(data) {
      if (data){
        $.ajax({
          url: t,
          dataType: 'xml',
          async: false,
          success: function(mapdata){
            var width = parseInt(mapdata.firstChild.childNodes[1].attributes.Width.textContent);
            crds = tileToPixel(data.layerXTile, data.layerYTile);
            var lvl;
            for (lvl = 0; lvl <= currentLevel; lvl++){
              viewer.addLayer({
                tileSource: "maps/"+desc+"L"+lvl+"/map.xml",
                opacity: 1,
                x: crds.x / viewer.source.width,
                y: (crds.y - (96 * lvl)) / (viewer.source.height * viewer.source.aspectRatio),
                width: width / viewer.source.width
              });
            }

            $.ajax({
              url: o,
              async: true,
              dataType: 'json',
              success: function(newoverlays){
                var map = $("#map");
                for(var i=0; i<newoverlays.length; i++){
                  //map.append("<img id=\""+newoverlays[i].id+"\" src=\"images/mapcircleblue_"+circleSize()+".png\" class=\"poi global-poi\">");
                  map.append(makePoiImage(newoverlays[i].id, "global-poi"));
                  newoverlays[i].px += crds.x;
                  newoverlays[i].py += crds.y;
                  overlays.push(newoverlays[i]);
                  newoverlays[i].placement = OpenSeadragon.OverlayPlacement.CENTER;
                  newoverlays[i].onDraw = OpenSeadragon.DrawCenteredCallback;
                  viewer.currentOverlays.push(addOverlayFromConfiguration(viewer.drawer, newoverlays[i]));
                  bindtooltip(newoverlays[i].id.replace(/^overlay-/, ""));
                }
              },
            });
          }
        });
      }
    },
    error: function(a, b, c){
      console.log(a);
      console.log(b);
      console.log(c);
    }
  });
  btn.one("click", btn, removeLayer);
}}}

function removeLayer(data){{{
  var btn = data.data;
  var desc = btn.attr("desc");

  if (!desc.match(/^[A-Za-z0-9_]*$/)){
    return;
  }

  var i;
  for (i = 0; i < viewer.drawers.length; i++){
    var v = viewer.drawers[i];
    if (v.source.tilesUrl.match(new RegExp("/"+desc+"L[0-9]*/"))){
      viewer.removeLayer(v);
      i = 0;
    }
  }

  var o = "maps/"+desc+"/overlays.json";
  $.ajax({
    url: o,
    async: true,
    dataType: 'json',
    success: function(overlays){
      for(var i=0; i<overlays.length; i++){
        viewer.removeOverlay(overlays[i].id);
        $("option[value="+overlays[i].id+"]").remove();
      }
    }
  });

  btn.one("click", btn, addLayer);
}}}

function changeLevel(){{{
  var newLevel = parseInt($(this).val());

  if (currentLevel == newLevel){
    return;
  }

  for (var drawerID=0; drawerID < viewer.drawers.length; drawerID++){
    var drawer = viewer.drawers[drawerID];
    var desc = drawer.source.tilesUrl; // "maps/Challenge1L0/map_files/"
    desc = desc.match(/maps\/(.*?)L0/); // "Challenge1"
    if (desc == null){ // check for successful match
      continue
    }
    desc = desc[1];
    if (desc.length == 0){ // check for empty string
      continue;
    }
    if (newLevel > currentLevel){
      var lvl = currentLevel;
      for (lvl++; lvl <= newLevel; lvl++){
        var t = "maps/"+desc+"L"+lvl+"/map.xml";
        $.ajax({
          url: t,
          dataType: 'xml',
          async: false,
          success: function(mapdata){
            viewer.addLayer({
              tileSource: t,
              opacity: 1,
              x: drawer._worldX,
              y: drawer._worldY - ((96 * lvl) / (viewer.source.height * viewer.source.aspectRatio)),
              width: drawer._worldWidth
            });
          }
        });
      }
    } else {
      var lvl = currentLevel;
      for (lvl; lvl > newLevel; lvl--){
        $.each(viewer.drawers, function(k, v){
          if (v.source.tilesUrl.match(new RegExp("/"+desc+"L"+lvl+"/"))){
            drawerID = 0;
            viewer.removeLayer(v);
            return false; // break
          }
        });
      }
    }
  }
  currentLevel = newLevel;
}}}

function makePoiImage(id, className) {
  if(typeof className!= "string")
    className = "global-poi";
  return "<svg viewbox=\"0 0 70 70\" id=\""+id+"\" class=\"poi "+className+"\"><circle class=\"circle\" fill=\"blue\" stroke-width=\"4.5\" stroke=\"#000\" cx=\"35\" cy=\"35\" r=\"30\" /></svg>";
}

function addPoi(options) {
  if(!options)
    options = {};
  // load default optionjs
  for(var i in addPoi.defaults) {
    if(options[i]==null) {
       options[i] = addPoi.defaults[i];
    } 
  }
  if(options.px==null||options.py==null)
    throw new Error("Adding POI without coordinates!");
  
  var image = $( makePoiImage(options.id, "poi "+options.imageClassName) ).appendTo( "#map" );        
  var result;
  viewer.currentOverlays.push(result=addOverlayFromConfiguration(viewer.drawer, options)); 
  return result;
}
addPoi.defaults = {
    className: "highlight private",
    imageClassName: "",
    text: "Unnamed POI",
    scales: false,
    placement: OpenSeadragon.OverlayPlacement.CENTER,
    // Causes the coordinates to be recalculated so that the object
    // is centered around them, rather than toutchning them with corner
    onDraw: OpenSeadragon.DrawCenteredCallback,
    // Property
    //properties: {dd: 2}
};
// Totally freaky way I define unique identifiers.
(() => {
  var id = 0;
  Object.defineProperty(addPoi.defaults, "id", {
      get: () => {return "unique_"+(++id);},
      enumerable: true,
      configurable: false
    }
  );
})();


OpenSeadragon.Rect.fromDomRect = function(r) {
  return new OpenSeadragon.Rect(r.left, r.top, r.width, r.height);
}

function showLicense(){{{
  jNotice('The images of the maps are licensed to you under the following license agreement:<br /><a rel="license" href="http://creativecommons.org/licenses/by-nc-sa/4.0/"><img alt="Creative Commons License" style="border-width:0" src="http://i.creativecommons.org/l/by-nc-sa/4.0/88x31.png" /></a><br /><span xmlns:dct="http://purl.org/dc/terms/" href="http://purl.org/dc/dcmitype/InteractiveResource" property="dct:title" rel="dct:type">Project Zomboid Map Project</span> by <a xmlns:cc="http://creativecommons.org/ns#" href="http://pzmap.crash-override.net/" property="cc:attributionName" rel="cc:attributionURL">Benjamin Schieder</a> is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-nc-sa/4.0/">Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License</a>.<br /><br />The source code of OpenSeaDragon is licensed under the New BSD license. Check <a href="http://openseadragon.github.io/">OpenSeaDragons website</a> for more information.<br /><br />The source code of Project Zomboid Map Project is considered to be in the public domain.', undefined, $("#map"));
}}}



function showBitTorrent(){{{
  jNotice("<h3>BitTorrent dowloads</h3><br />"+
      "<ul>"+
      "<li><a href='torrent/pzmap_offline_20150225.tar.bz2.torrent'>Base Package (2015-02-25)</a><br />includes <b>only</b> the website. You <b>need</b> this one.</li>"+
      "<li><a href='torrent/pzmap_offline_20150225_survival_base.tar.torrent'>Base Package Muldraugh and West Point Level 0 (2015-02-25</a><br />includes Level 0 of the Survival map.</li>"+
      "<li><a href='torrent/pzmap_offline_20150225_survival_extension.tar.torrent'>Extension Package Muldraugh and West Point (2015-02-25)</a><br >include the Levels 1 to 7 of Muldraugh and West Point.</li>"+
      "<li><a href='torrent/pzmap_offline_20150225_challenge_extension.tar.torrent'>Extension Package Last Stand (2015-02-25)</a><br />includes the two 'Challenge' or 'Last Stand' maps with all levels.</li>"+
      "<li><a href='torrent/pzmap_offline_20150225_bedford_falls_extension.tar.torrent'>Extension Package Bedford Falls v2 (2015-02-25)</a><br />includes Bedford Falls v2 with all levels.</li>"+
      "<li><a href='torrent/pzmap_offline_20150225_dreadwood_extension.tar.torrent'>Extension Package Dreadwood (2015-02-25)</a><br />includes Dreadwood with all levels.</li>"+
      "<li><a href='torrent/pzmap_offline_20150225_new_denver_extension.tar.torrent'>Extension Package New Denver (2015-02-25)</a><br />includes New Denver with all levels.</li>"+
      "<li><a href='torrent/pzmap_offline_20150225_phoenix_extension.tar.torrent'>Extension Package Phoenix (2015-02-25)</a><br />includes Phoenix with all levels.</li>"+
      "<li><a href='torrent/pzmap_offline_20150225_twdprison_extension.tar.torrent'>Extension Package TWD Prison (2015-02-25)</a><br />includes TWD Prison with all levels.</li>"+
      "<li><a href='torrent/pzmap_offline_20150225_vacation_island_extension.tar.torrent'>Extension Package Vacation Island (2015-02-25)</a><br />includes Vacation Island with all levels.</li>"+
      "</ul>", undefined, $("#map"));
}}}

$(document).ready(function(){
  runOSD();
  $("#btnAddPOI").on("click", addPOI);
  $("#btnTogglePOI").on("click", togglePOI);
  $("#btnFlushPOI").on("click", flushPOI);
  $("#selPOI").on("change", zoomToPOI);
  $("#btnLockCoords").one("click", lockCoords);
  $("#btnLicense").on("click", showLicense);
  $("#layerDreadwood").one("click", $("#layerDreadwood"), addLayer);
  $("#layerBedfordFalls").one("click", $("#layerBedfordFalls"), addLayer);
  $("#layerNewDenver").one("click", $("#layerNewDenver"), addLayer);
  $("#layerTWDPrisonv3").one("click", $("#layerTWDPrisonv3"), addLayer);
  $("#layerRebuildv1").one("click", $("#layerRebuildv1"), addLayer);
  $(".selectlevel").on("change", changeLevel);
  $("#btnDownloadBitTorrent").on("click", showBitTorrent);
  window.onresize();
});

// Convenience
$('#footer').remove(); window.onresize();

/** 
 * Responsible for fetching all remote POIs and displaying them on the map **/
function RemotePOIRenderer(viewer) {
  this.viewer = viewer;
  this.zombies = {};
  this.pois = {};
  // Allow drawing every update
  viewer.addHandler("update-viewport", this.drawPointsOnCanvas=this.drawPointsOnCanvas.bind(this));
}

/**
var r = new RemotePOIRenderer(viewer); 
r.fetchInfo(); 
 
 
 **/
RemotePOIRenderer.prototype.fetchInfo = function() {
  //if(this.fetchingInfo) {
  //  console.warn("Already fetching player info.");
  //  return false;
  //}
  //this.fetchingInfo = true;
  //$.get("http://127.0.0.1:8080/test", {}, this.displayPoints.bind(this));
  this.displayPoints(fakeZombies);
}


RemotePOIRenderer.prototype.displayPoints = function(points) {
  //console.log(points);
  //if(typeof points=="string")
  //  console.log(points=JSON.parse(points));
  if(points.zombies) {
    var zombies = points.zombies;
    this.zombies = points.zombies;
    var newZombies = 0;
    /*for(var i=0,l=zombies.length; i<l; i++) {
      var id = "zombie-"+zombies[i].id;
      var coords = tileToPixel(zombies[i].coordinates[0], zombies[i].coordinates[1]);
      var zombOverlay = this.pois[id];
      if(zombOverlay == null) {
        ++newZombies;
        var overlay = {
          px: coords.x,
          py: coords.y + (tileHeight / 2),
          imageClassName: "zombie-poi", 
          text: "Zombie!!!",
          id: id,
          scales: true,
        };
        zombOverlay = this.pois[id] = addPoi(overlay);
      }
      else {
        var rect = new OpenSeadragon.Point(coords.x, coords.y);
        rect = this.viewer.drawer.viewport.imageToViewportRectangle( rect );
  
        zombOverlay.bounds.x = rect.x;
        zombOverlay.bounds.y = rect.y;
      }     
    }    */
    //console.log(newZombies+" zombies downloaded.");
    viewer.drawer.updateAgain = true;
    
  }
}
RemotePOIRenderer.prototype.drawPointsOnCanvas = function(nope, nope2, isCanvas) {

  var ctx = this.viewer.drawer.context;

  //console.log("Drawing zombies on map.");
  var zombies = this.zombies;
  var zombies_length = zombies.length;
  
  var zoomRatio = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom(true));
  var radius = 20*zoomRatio; 
  
  if(radius>1000) {
    ctx.fillStyle = 'red';
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 1;
  
    var drawer = this.viewer.drawer;
    // Constrains used to prevent drawing circles outside the canvas
    var canvas = this.viewer.drawer.canvas;
    var minx = 0-radius/2;
    var maxx = canvas.width + radius/2;
    var miny = minx;
    var maxy = canvas.height + radius/2;
    // Tmp variable
    var coords;                    
    for(var i=0; i<zombies_length; i++) {
      if((coords=zombies[i].pixel)==null)
        coords = zombies[i].pixel = tileToPixel(zombies[i].coordinates[0], zombies[i].coordinates[1], drawer);
      
      var px = imagePixeltoCanvasPixel(coords);
      
      // skip points out of bounds
      if(px.x>maxx || px.x<minx || px.y>maxy || px.y<miny)
        continue;
      // Draw circle
      ctx.beginPath();       
      ctx.arc(Math.round(px.x), Math.round(px.y), radius, 0, 2 * Math.PI, false);
      ctx.stroke();
      ctx.fill();
    }
  }
  // Calculate densities
  else {
    var drawer = this.viewer.drawer;   
    var canvas = this.viewer.drawer.canvas;
    var h = canvas.height;
    var w = canvas.width; 
    // To loop over more than 1 pixel (performance)
    // This will create lot of small squares instead of individual pixels
    var tileSize = 10;
    var halfRadius = Math.floor(tileSize/2);
    // This number represents pixel "size" of one rendered tile
    // half of it is substracted from all distances as those that are smaller
    // are INSIDE the tile and should be 0
    var tileSizeOnMap = (tileSize/zoomRatio)/2;
    // Used to compare with squared distances
    var tileSizeOnMapSquared = tileSizeOnMap*tileSizeOnMap;
    
    var time = performance.now();
    // "Squared" because we didnt unsquare it   
    function distanceSquared(A, B) {
      return (A.x-B.x)*(A.x-B.x)+(A.y-B.y)*(A.y-B.y);
    }
    // We only convert first point, then use zoom ratio to calculate differences
    var zeroPoint = canvasPixeltoImagePixel(0, 0);
    // We CEIL the number of tiles
    // For example if there's w=11 and tileSize=10 two tiles fit in the image, one at x=0
    // and one at x=10. ceil(11/10)=2, exactly what we need
    var tilesx = Math.ceil(w/tileSize);
    var tilesy = Math.ceil(h/tileSize);
    var pixels = new Float64Array(tilesx*tilesy);
    // Since array offsets do not equal pixel offsets we can either calculate them using some
    // division or just iterate them separately
    var ar_x = 0;
    var ar_y = 0;
    
    // Loop for every x,y pixel (or region of pixels)
    for(var y=0; y<h; y+=tileSize) {
      ar_x = 0;
      for(var x=0; x<w; x+=tileSize) {
         // Time security - stop rendering after 1 second
         if(performance.now()-time>600) {
            x=w;y=h;break;
         }
         // Convert relative canvas offset to absolute point on the map
         var point = {x:x/zoomRatio+zeroPoint.x, y:y/zoomRatio+zeroPoint.y};
         // For every zombie add sqrt(distance from this point to zombie)
         var distancesRoot = 0;
         // Loop over the zombies
         var zombieCoords; 
         for(var i=0; i<zombies_length; i++) {
           // Get single zombie coordinates as {x:0, y:0}
           if((coords=zombies[i].pixel)==null)
             coords = zombies[i].pixel = tileToPixel(zombies[i].coordinates[0], zombies[i].coordinates[1], drawer);
           // square root is a) slow and b) probably not what I want anyway
           var dist = distanceSquared(coords, point);
           // Distance is zero
           if(dist<tileSizeOnMapSquared || dist==0)
             dist = 1;
           else
             dist-=tileSizeOnMapSquared;
           distancesRoot+=Math.min(300/dist, 300); 
         }
         if(ar_y+ar_x>=pixels.length)
           throw new Error("array index out of bounds!");
         pixels[ar_y+ar_x] = distancesRoot;
         // Iterate array x offset
         ar_x++;
      } 
      // Add full row, not just one number
      // We're using + with the x,y offsets then, look above
      ar_y+=tilesx;
    }  
    //var pixels = quantizePoints(zombies, w, h, tileSize, zeroPoint, zoomRatio);
    //console.log(pixels);
    for(var i=0,l=pixels.length; i<l; i++) {
      if(pixels[i]<0.01)
        continue;
      var x = i%h;
      var y = Math.floor(i/h);
      // The higher the sum of distances is, the more intensive should the color be
      var style = 'rgba(255,0,0,'+pixels[i]+')';
      //console.log(style);
      // Kill the console immediatelly
      //console.log(style);
      // Maybe we should sample and cache the transparency styles since there's limited ammount of colors?
      ctx.fillStyle = style;
      ctx.fillRect(x-halfRadius,y-halfRadius,tileSize,tileSize);
    }
  }
  //if(!isCanvas)
  //  setTimeout(this.drawPointsOnCanvas, 0, null, null, true);   
}
function quantizePoints(points, w, h, tileSize, zeroPoint, zoomRatio)
{
  var halfRadius = Math.floor(tileSize/2);
  // This number represents pixel "size" of one rendered tile
  // half of it is substracted from all distances as those that are smaller
  // are INSIDE the tile and should be 0
  var tileSizeOnMap = (tileSize/zoomRatio)/2;
  // Used to compare with squared distances
  var tileSizeOnMapSquared = tileSizeOnMap*tileSizeOnMap;
  
  // "Squared" because we didnt unsquare it   
  function distanceSquared(A, B) {
    return (A.x-B.x)*(A.x-B.x)+(A.y-B.y)*(A.y-B.y);
  }
  // Fixed size array is faster
  var pixels = new Float64Array(w*h);
  var points_length = points.length;
  
  for(var y=0; y<h; y+=tileSize) {
    // Current offset in 1D array
    var offset = y*w;
    for(var x=0; x<w; x+=tileSize) {
       // Time security - stop rendering after 1 second
       //if(performance.now()-time>600) {
       //   x=w;y=h;break;
       //}
       // Convert relative canvas offset to absolute point on the map
       var point = {x:x/zoomRatio+zeroPoint.x, y:y/zoomRatio+zeroPoint.y};
       // For every zombie add sqrt(distance from this point to zombie)
       var distancesRoot = 0;
       // Loop over the points
       var zombieCoords; 
       for(var i=0; i<points_length; i++) {
         // Get single zombie coordinates as {x:0, y:0}
         if((coords=points[i].pixel)==null) {
           if(!tileToPixel)
             continue;
           coords = points[i].pixel = tileToPixel(points[i].coordinates[0], points[i].coordinates[1], viewer.drawer);
         }
           
         // square root is a) slow and b) probably not what I want anyway
         var dist = distanceSquared(coords, point);
         // Distance is zero
         if(dist<tileSizeOnMapSquared || dist==0)
           dist = 1;
         else
           dist-=tileSizeOnMapSquared;
         distancesRoot+=Math.min(300/dist, 300); 
       }
       pixels[offset+x] = distancesRoot;
    } 
  }
  return pixels;
}  


window.RemotePOIRenderer = RemotePOIRenderer;



function PlayerPOI(viewer) {
  this.viewer = viewer;
}
PlayerPOI.prototype.getPOIObject = function() {


}

function UniqueIdGenerator(prefix) {
  var id = 0;
  if(typeof prefix != "string")
    prefix = "";
  Object.defineProperty(this, "id", {
      get: () => {return prefix+(++id);},
      enumerable: true,
      configurable: false
    }
  );
}


/** Fake zombie list: **/
var fakeZombies = {
  "zombies": [
    {"id": 1, "coordinates": [10872.3, 10121.7, 1.0]},
    {"id": 2, "coordinates": [10872.2, 10122.5, 1.0]},
    {"id": 3, "coordinates": [10871.643, 10122.19, 0.0]},
    {"id": 4, "coordinates": [10853.614, 10080.111, 0.0]},
    {"id": 5, "coordinates": [10850.877, 10081.007, 0.0]},
    {"id": 7, "coordinates": [10851.474, 10081.005, 0.0]},
    {"id": 8, "coordinates": [10854.161, 10081.084, 0.0]},
    {"id": 9, "coordinates": [10855.842, 10138.759, 0.0]},
    {"id": 10, "coordinates": [10872.527, 10081.939, 0.0]},
    {"id": 11, "coordinates": [10857.654, 10138.929, 0.0]},
    {"id": 12, "coordinates": [10854.933, 10140.575, 0.0]},
    {"id": 13, "coordinates": [10853.708, 10140.084, 0.0]},
    {"id": 14, "coordinates": [10874.348, 10083.025, 0.0]},
    {"id": 15, "coordinates": [10884.416, 10102.208, 0.0]},
    {"id": 16, "coordinates": [10881.0, 10100.419, 0.0]},
    {"id": 17, "coordinates": [10880.322, 10099.621, 0.0]},
    {"id": 18, "coordinates": [10880.751, 10101.078, 0.0]},
    {"id": 19, "coordinates": [10872.9795, 10113.468, 1.0]},
    {"id": 20, "coordinates": [10873.5, 10113.992, 1.0]},
    {"id": 21, "coordinates": [10876.929, 10113.456, 1.0]},
    {"id": 22, "coordinates": [10873.669, 10114.966, 1.0]},
    {"id": 23, "coordinates": [10871.9375, 10115.503, 1.0]},
    {"id": 24, "coordinates": [10872.721, 10116.289, 1.0]},
    {"id": 25, "coordinates": [10875.662, 10116.684, 1.0]},
    {"id": 26, "coordinates": [10876.05, 10116.233, 1.0]},
    {"id": 27, "coordinates": [10877.044, 10116.471, 1.0]},
    {"id": 28, "coordinates": [10871.499, 10117.123, 1.0]},
    {"id": 29, "coordinates": [10871.93, 10116.461, 1.0]},
    {"id": 30, "coordinates": [10872.083, 10117.036, 1.0]},
    {"id": 31, "coordinates": [10875.007, 10117.025, 1.0]},
    {"id": 32, "coordinates": [10871.621, 10118.8, 1.0]},
    {"id": 33, "coordinates": [10872.712, 10118.601, 1.0]},
    {"id": 34, "coordinates": [10872.126, 10118.483, 1.0]},
    {"id": 35, "coordinates": [10873.452, 10118.054, 1.0]},
    {"id": 36, "coordinates": [10876.569, 10118.241, 1.0]},
    {"id": 37, "coordinates": [10877.475, 10118.04, 1.0]},
    {"id": 38, "coordinates": [10874.677, 10119.559, 1.0]},
    {"id": 39, "coordinates": [10874.425, 10119.018, 1.0]},
    {"id": 40, "coordinates": [10871.81, 10103.211, 0.0]},
    {"id": 41, "coordinates": [10877.475, 10101.769, 0.0]},
    {"id": 42, "coordinates": [10875.108, 10104.065, 0.0]},
    {"id": 43, "coordinates": [10873.634, 10102.45, 0.0]},
    {"id": 44, "coordinates": [10899.028, 10085.856, 0.0]},
    {"id": 45, "coordinates": [10894.257, 10091.165, 0.0]},
    {"id": 46, "coordinates": [10890.403, 10113.849, 0.0]},
    {"id": 47, "coordinates": [10895.103, 10089.537, 0.0]},
    {"id": 48, "coordinates": [10891.873, 10089.4375, 0.0]},
    {"id": 49, "coordinates": [10893.595, 10089.07, 0.0]},
    {"id": 50, "coordinates": [10907.901, 10134.629, 0.0]},
    {"id": 51, "coordinates": [10916.307, 10094.755, 1.0]},
    {"id": 52, "coordinates": [10918.589, 10094.239, 1.0]},
    {"id": 53, "coordinates": [10918.683, 10094.991, 1.0]},
    {"id": 54, "coordinates": [10917.87, 10095.058, 1.0]},
    {"id": 55, "coordinates": [10917.274, 10095.014, 1.0]},
    {"id": 56, "coordinates": [10919.001, 10095.526, 1.0]},
    {"id": 57, "coordinates": [10921.554, 10098.009, 1.0]},
    {"id": 58, "coordinates": [10919.022, 10097.941, 1.0]},
    {"id": 59, "coordinates": [10919.981, 10098.058, 1.0]},
    {"id": 60, "coordinates": [10917.93, 10098.495, 1.0]},
    {"id": 61, "coordinates": [10918.999, 10098.537, 1.0]},
    {"id": 62, "coordinates": [10917.937, 10101.937, 0.0]},
    {"id": 63, "coordinates": [10918.53, 10101.88, 0.0]},
    {"id": 64, "coordinates": [10919.005, 10102.497, 0.0]},
    {"id": 65, "coordinates": [10919.126, 10101.906, 0.0]},
    {"id": 66, "coordinates": [10906.562, 10104.102, 0.0]},
    {"id": 67, "coordinates": [10911.088, 10101.612, 0.0]},
    {"id": 68, "coordinates": [10908.395, 10102.677, 0.0]},
    {"id": 69, "coordinates": [10912.151, 10101.195, 0.0]},
    {"id": 70, "coordinates": [10919.006, 10100.476, 0.0]},
    {"id": 71, "coordinates": [10909.22, 10135.04, 0.0]},
    {"id": 72, "coordinates": [10905.428, 10136.147, 0.0]},
    {"id": 73, "coordinates": [10915.028, 10131.22, 0.0]},
    {"id": 74, "coordinates": [10915.567, 10131.897, 0.0]},
    {"id": 75, "coordinates": [10917.475, 10131.906, 0.0]},
    {"id": 76, "coordinates": [10917.85, 10133.604, 0.0]},
    {"id": 77, "coordinates": [10915.927, 10132.451, 0.0]},
    {"id": 78, "coordinates": [10917.357, 10134.414, 0.0]},
    {"id": 79, "coordinates": [10918.654, 10136.105, 0.0]},
    {"id": 80, "coordinates": [10917.087, 10135.377, 0.0]},
    {"id": 81, "coordinates": [10918.401, 10131.868, 0.0]},
    {"id": 82, "coordinates": [10918.811, 10135.097, 0.0]},
    {"id": 83, "coordinates": [10917.521, 10137.077, 0.0]},
    {"id": 84, "coordinates": [10907.927, 10135.302, 0.0]},
    {"id": 85, "coordinates": [10905.012, 10135.262, 0.0]},
    {"id": 86, "coordinates": [10905.938, 10132.693, 0.0]},
    {"id": 87, "coordinates": [10921.497, 10096.933, 0.0]},
    {"id": 88, "coordinates": [10915.499, 10096.336, 0.0]},
    {"id": 89, "coordinates": [10920.961, 10098.215, 0.0]},
    {"id": 90, "coordinates": [10921.432, 10094.958, 1.0]},
    {"id": 91, "coordinates": [10921.71, 10095.875, 1.0]},
    {"id": 92, "coordinates": [10921.118, 10095.947, 1.0]},
    {"id": 93, "coordinates": [10923.74, 10095.533, 1.0]},
    {"id": 94, "coordinates": [10920.445, 10096.871, 1.0]},
    {"id": 95, "coordinates": [10920.882, 10096.472, 1.0]},
    {"id": 96, "coordinates": [10922.062, 10096.465, 1.0]},
    {"id": 97, "coordinates": [10920.721, 10097.734, 1.0]},
    {"id": 98, "coordinates": [10920.342, 10097.449, 1.0]},
    {"id": 99, "coordinates": [10921.09, 10097.024, 1.0]},
    {"id": 100, "coordinates": [10920.433, 10098.488, 1.0]},
    {"id": 101, "coordinates": [10922.541, 10099.043, 1.0]},
    {"id": 102, "coordinates": [10921.244, 10100.127, 1.0]},
    {"id": 103, "coordinates": [10921.226, 10101.533, 1.0]},
    {"id": 104, "coordinates": [10922.1, 10102.332, 1.0]},
    {"id": 105, "coordinates": [10932.92, 10149.956, 0.0]},
    {"id": 106, "coordinates": [10932.333, 10148.983, 0.0]},
    {"id": 107, "coordinates": [10932.448, 10148.132, 0.0]},
    {"id": 108, "coordinates": [10940.1455, 10085.975, 0.0]},
    {"id": 109, "coordinates": [10939.259, 10100.338, 0.0]},
    {"id": 110, "coordinates": [10939.378, 10104.872, 0.0]},
    {"id": 111, "coordinates": [10933.033, 10146.134, 0.0]},
    {"id": 112, "coordinates": [10931.282, 10148.113, 0.0]},
    {"id": 113, "coordinates": [10934.9375, 10135.313, 0.0]},
    {"id": 114, "coordinates": [10930.951, 10128.003, 0.0]},
    {"id": 115, "coordinates": [10934.076, 10127.511, 0.0]},
    {"id": 116, "coordinates": [10932.395, 10129.023, 0.0]},
    {"id": 117, "coordinates": [10930.935, 10133.551, 0.0]},
    {"id": 118, "coordinates": [10932.862, 10131.84, 0.0]},
    {"id": 119, "coordinates": [10931.243, 10129.09, 0.0]},
    {"id": 120, "coordinates": [10939.604, 10126.037, 0.0]},
    {"id": 121, "coordinates": [10939.859, 10132.648, 0.0]},
    {"id": 122, "coordinates": [10944.012, 10113.349, 0.0]},
    {"id": 123, "coordinates": [10943.046, 10116.595, 0.0]},
    {"id": 124, "coordinates": [10947.217, 10117.174, 0.0]},
    {"id": 125, "coordinates": [10947.75, 10132.355, 0.0]},
    {"id": 126, "coordinates": [10943.012, 10134.759, 0.0]},
    {"id": 127, "coordinates": [10941.981, 10137.184, 0.0]},
    {"id": 128, "coordinates": [10944.237, 10144.32, 0.0]},
    {"id": 129, "coordinates": [10945.635, 10149.004, 0.0]},
    {"id": 130, "coordinates": [10954.848, 10098.95, 0.0]},
    {"id": 131, "coordinates": [10951.009, 10111.866, 0.0]},
    {"id": 132, "coordinates": [10954.423, 10115.067, 0.0]},
    {"id": 133, "coordinates": [10952.664, 10118.207, 0.0]},
    {"id": 134, "coordinates": [10952.349, 10119.98, 0.0]},
    {"id": 135, "coordinates": [10958.687, 10127.691, 0.0]},
    {"id": 136, "coordinates": [10958.253, 10128.104, 0.0]},
    {"id": 137, "coordinates": [10956.029, 10138.679, 0.0]},
    {"id": 138, "coordinates": [10941.269, 10089.3955, 0.0]},
    {"id": 139, "coordinates": [10945.235, 10087.942, 0.0]},
    {"id": 140, "coordinates": [10935.68, 10092.714, 0.0]},
    {"id": 141, "coordinates": [10941.896, 10088.948, 0.0]},
    {"id": 142, "coordinates": [10938.817, 10089.3545, 0.0]},
    {"id": 148, "coordinates": [10929.276, 10114.859, 0.0]},
    {"id": 149, "coordinates": [10936.169, 10120.6455, 0.0]},
    {"id": 150, "coordinates": [10930.151, 10117.681, 0.0]},
    {"id": 151, "coordinates": [10929.003, 10113.436, 0.0]},
    {"id": 152, "coordinates": [10886.216, 10100.417, 0.0]},
    {"id": 153, "coordinates": [10876.994, 10099.743, 0.0]},
    {"id": 154, "coordinates": [10881.863, 10102.11, 0.0]},
    {"id": 155, "coordinates": [10877.326, 10098.548, 0.0]},
    {"id": 156, "coordinates": [10885.007, 10099.235, 0.0]},
    {"id": 162, "coordinates": [10876.446, 10092.487, 0.0]},
    {"id": 163, "coordinates": [10875.657, 10090.812, 0.0]},
    {"id": 164, "coordinates": [10877.0, 10087.874, 0.0]},
    {"id": 165, "coordinates": [10872.344, 10089.789, 0.0]},
    {"id": 166, "coordinates": [10878.721, 10083.64, 0.0]},
    {"id": 167, "coordinates": [10872.032, 10129.068, 0.0]},
    {"id": 168, "coordinates": [10904.605, 10081.338, 0.0]},
    {"id": 169, "coordinates": [10900.175, 10083.814, 0.0]},
    {"id": 174, "coordinates": [10909.051, 10083.087, 0.0]},
    {"id": 175, "coordinates": [10903.918, 10088.41, 0.0]},
    {"id": 176, "coordinates": [10907.022, 10081.81, 0.0]},
    {"id": 177, "coordinates": [10904.132, 10083.654, 0.0]},
    {"id": 178, "coordinates": [10878.672, 10087.347, 0.0]},
    {"id": 179, "coordinates": [10882.419, 10095.105, 0.0]},
    {"id": 180, "coordinates": [10887.001, 10096.006, 0.0]},
    {"id": 181, "coordinates": [10879.192, 10101.869, 0.0]},
    {"id": 182, "coordinates": [10882.004, 10098.282, 0.0]},
    {"id": 183, "coordinates": [10888.908, 10093.12, 0.0]},
    {"id": 184, "coordinates": [10868.785, 10103.125, 0.0]},
    {"id": 186, "coordinates": [10903.459, 10149.288, 0.0]},
    {"id": 190, "coordinates": [10924.186, 10126.812, 0.0]},
    {"id": 191, "coordinates": [10942.559, 10141.639, 0.0]},
    {"id": 192, "coordinates": [10938.609, 10140.971, 0.0]},
    {"id": 193, "coordinates": [10924.64, 10126.36, 0.0]},
    {"id": 194, "coordinates": [10928.449, 10141.883, 0.0]},
    {"id": 200, "coordinates": [10949.786, 10085.646, 0.0]},
    {"id": 201, "coordinates": [10946.796, 10090.487, 0.0]},
    {"id": 202, "coordinates": [10946.86, 10091.088, 0.0]},
    {"id": 203, "coordinates": [10948.25, 10085.922, 0.0]},
    {"id": 204, "coordinates": [10947.09, 10087.595, 0.0]},
    {"id": 222, "coordinates": [10931.551, 10128.723, 0.0]},
    {"id": 223, "coordinates": [10934.888, 10126.107, 0.0]},
    {"id": 224, "coordinates": [10936.596, 10131.481, 0.0]},
    {"id": 225, "coordinates": [10934.906, 10123.873, 0.0]},
    {"id": 226, "coordinates": [10936.627, 10133.313, 0.0]},
    {"id": 227, "coordinates": [10955.117, 10090.012, 0.0]},
    {"id": 228, "coordinates": [10956.378, 10093.721, 0.0]},
    {"id": 229, "coordinates": [10925.58, 10115.236, 0.0]},
    {"id": 230, "coordinates": [10928.051, 10115.516, 0.0]},
    {"id": 231, "coordinates": [10916.019, 10118.676, 0.0]},
    {"id": 232, "coordinates": [10918.515, 10113.875, 0.0]},
    {"id": 233, "coordinates": [10929.891, 10107.835, 0.0]},
    {"id": 234, "coordinates": [10905.07, 10105.499, 0.0]},
    {"id": 235, "coordinates": [10908.422, 10093.5, 0.0]},
    {"id": 236, "coordinates": [10906.701, 10093.497, 0.0]},
    {"id": 237, "coordinates": [10920.471, 10103.051, 0.0]},
    {"id": 238, "coordinates": [10906.806, 10104.542, 0.0]},
    {"id": 240, "coordinates": [10953.003, 10087.001, 0.0]},
    {"id": 241, "coordinates": [10950.785, 10087.988, 0.0]},
    {"id": 243, "coordinates": [10951.805, 10085.976, 0.0]},
    {"id": 244, "coordinates": [10950.298, 10093.438, 0.0]},
    {"id": 245, "coordinates": [10945.373, 10090.154, 0.0]},
    {"id": 246, "coordinates": [10946.765, 10084.423, 0.0]},
    {"id": 247, "coordinates": [10947.613, 10083.471, 0.0]},
    {"id": 248, "coordinates": [10928.684, 10100.061, 0.0]},
    {"id": 249, "coordinates": [10924.624, 10105.808, 0.0]},
    {"id": 250, "coordinates": [10924.152, 10109.311, 0.0]},
    {"id": 251, "coordinates": [10927.231, 10111.721, 0.0]},
    {"id": 252, "coordinates": [10933.045, 10103.465, 0.0]},
    {"id": 253, "coordinates": [10948.676, 10127.014, 0.0]},
    {"id": 254, "coordinates": [10952.374, 10134.047, 0.0]},
    {"id": 255, "coordinates": [10949.799, 10130.409, 0.0]},
    {"id": 256, "coordinates": [10948.373, 10128.232, 0.0]},
    {"id": 257, "coordinates": [10955.485, 10137.03, 0.0]},
    {"id": 258, "coordinates": [10930.52, 10093.095, 0.0]},
    {"id": 259, "coordinates": [10948.179, 10100.255, 0.0]},
    {"id": 260, "coordinates": [10943.6, 10102.399, 0.0]},
    {"id": 261, "coordinates": [10942.139, 10091.84, 0.0]},
    {"id": 262, "coordinates": [10941.318, 10087.794, 0.0]},
    {"id": 263, "coordinates": [10948.17, 10105.295, 0.0]},
    {"id": 264, "coordinates": [10968.723, 10107.518, 0.0]},
    {"id": 265, "coordinates": [10969.709, 10106.617, 0.0]},
    {"id": 266, "coordinates": [10950.943, 10120.337, 0.0]},
    {"id": 267, "coordinates": [10957.649, 10111.361, 0.0]},
    {"id": 268, "coordinates": [10954.624, 10145.941, 0.0]},
    {"id": 269, "coordinates": [10950.331, 10141.517, 0.0]},
    {"id": 270, "coordinates": [10948.854, 10143.232, 0.0]},
    {"id": 271, "coordinates": [10952.893, 10144.84, 0.0]},
    {"id": 272, "coordinates": [10951.977, 10144.526, 0.0]},
    {"id": 273, "coordinates": [10931.27, 10127.003, 0.0]},
    {"id": 274, "coordinates": [10929.463, 10129.685, 0.0]},
    {"id": 275, "coordinates": [10928.091, 10128.087, 0.0]},
    {"id": 276, "coordinates": [10934.415, 10132.152, 0.0]},
    {"id": 277, "coordinates": [10933.49, 10129.489, 0.0]},
    {"id": 278, "coordinates": [10865.088, 10101.61, 0.0]},
    {"id": 279, "coordinates": [10868.777, 10104.6455, 0.0]},
    {"id": 280, "coordinates": [10874.0205, 10118.527, 0.0]},
    {"id": 281, "coordinates": [10864.869, 10104.575, 0.0]},
    {"id": 282, "coordinates": [10864.743, 10103.117, 0.0]},
    {"id": 283, "coordinates": [10873.082, 10123.475, 0.0]},
    {"id": 284, "coordinates": [10871.1045, 10122.446, 0.0]},
    {"id": 285, "coordinates": [10861.944, 10108.152, 0.0]},
    {"id": 286, "coordinates": [10864.674, 10112.892, 0.0]},
    {"id": 287, "coordinates": [10866.903, 10112.74, 0.0]},
    {"id": 288, "coordinates": [10892.814, 10140.881, 0.0]},
    {"id": 289, "coordinates": [10888.097, 10143.853, 0.0]},
    {"id": 290, "coordinates": [10892.705, 10141.714, 0.0]},
    {"id": 291, "coordinates": [10889.012, 10144.832, 0.0]},
    {"id": 292, "coordinates": [10891.626, 10142.842, 0.0]},
    {"id": 293, "coordinates": [10893.109, 10112.432, 0.0]},
    {"id": 294, "coordinates": [10899.501, 10110.068, 0.0]},
    {"id": 295, "coordinates": [10884.488, 10119.966, 0.0]},
    {"id": 296, "coordinates": [10895.27, 10104.454, 0.0]},
    {"id": 297, "coordinates": [10894.556, 10109.047, 0.0]},
    {"id": 298, "coordinates": [10867.025, 10114.975, 0.0]},
    {"id": 299, "coordinates": [10868.146, 10116.933, 0.0]},
    {"id": 300, "coordinates": [10866.753, 10120.205, 0.0]},
    {"id": 301, "coordinates": [10868.02, 10112.672, 0.0]},
    {"id": 302, "coordinates": [10927.893, 10084.557, 0.0]},
    {"id": 303, "coordinates": [10855.599, 10100.728, 0.0]},
    {"id": 304, "coordinates": [10853.018, 10101.84, 0.0]},
    {"id": 305, "coordinates": [10856.839, 10099.437, 0.0]},
    {"id": 306, "coordinates": [10853.783, 10098.9375, 0.0]},
    {"id": 307, "coordinates": [10855.139, 10103.429, 0.0]},
    {"id": 308, "coordinates": [10870.239, 10126.464, 0.0]},
    {"id": 309, "coordinates": [10867.661, 10123.039, 0.0]},
    {"id": 310, "coordinates": [10867.22, 10121.958, 0.0]},
    {"id": 311, "coordinates": [10866.13, 10129.759, 0.0]},
    {"id": 312, "coordinates": [10867.628, 10124.603, 0.0]},
    {"id": 313, "coordinates": [10943.976, 10134.988, 0.0]},
    {"id": 314, "coordinates": [10945.108, 10135.884, 0.0]},
    {"id": 315, "coordinates": [10945.525, 10139.677, 0.0]},
    {"id": 316, "coordinates": [10948.901, 10132.447, 0.0]},
    {"id": 317, "coordinates": [10949.603, 10137.75, 0.0]},
    {"id": 318, "coordinates": [10946.959, 10094.573, 0.0]},
    {"id": 319, "coordinates": [10948.0625, 10088.967, 0.0]},
    {"id": 320, "coordinates": [10948.897, 10093.988, 0.0]},
    {"id": 321, "coordinates": [10942.664, 10092.886, 0.0]},
    {"id": 322, "coordinates": [10914.851, 10093.655, 0.0]},
    {"id": 323, "coordinates": [10915.358, 10093.044, 0.0]},
    {"id": 324, "coordinates": [10912.736, 10091.237, 0.0]},
    {"id": 325, "coordinates": [10915.758, 10088.946, 0.0]},
    {"id": 326, "coordinates": [10914.586, 10093.045, 0.0]},
    {"id": 327, "coordinates": [10933.327, 10138.531, 0.0]},
    {"id": 328, "coordinates": [10923.965, 10144.6875, 0.0]},
    {"id": 329, "coordinates": [10923.171, 10147.071, 0.0]},
    {"id": 330, "coordinates": [10930.856, 10147.732, 0.0]},
    {"id": 331, "coordinates": [10929.25, 10146.868, 0.0]},
    {"id": 332, "coordinates": [10941.853, 10142.776, 0.0]},
    {"id": 333, "coordinates": [10939.446, 10142.136, 0.0]},
    {"id": 334, "coordinates": [10935.319, 10147.925, 0.0]},
    {"id": 335, "coordinates": [10932.787, 10144.486, 0.0]},
    {"id": 336, "coordinates": [10941.812, 10144.219, 0.0]}
  ]
};