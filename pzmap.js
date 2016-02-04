// ==UserScript==
// @name        Project Zomboid Map Patch
// @namespace   pz
// @include     /^https?://(www\.)?pzmap.crash\-override\.net.*?/
// @version     1
// @grant       none
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
	if (!viewer)
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
	}
	return "small";
}}}

function addOverlayFromConfiguration( drawer, overlay ) {{{
	/* Taken verbatim from OpenSeaDragon.js */
	var element  = null,
			rect = ( overlay.height && overlay.width ) ? new OpenSeadragon.Rect(
					overlay.x || overlay.px, 
					overlay.y || overlay.py, 
					overlay.width, 
					overlay.height
					) : new OpenSeadragon.Point(
						overlay.x || overlay.px, 
						overlay.y || overlay.py
						),
			id = overlay.id ? 
				overlay.id :
				"overlay-"+Math.floor(Math.random()*10000000);

	element = OpenSeadragon.getElement(overlay.id);
	if( !element ){
		element         = document.createElement("a");
		element.href    = "#/overlay/"+id;
	}
	element.id        = id;
	OpenSeadragon.addClass( element, overlay.className ?
			overlay.className :
			"openseadragon-overlay"
			);


	if(overlay.px !== undefined){
		//if they specified 'px' so its in pixel coordinates so
		//we need to translate to viewport coordinates
		rect = drawer.viewport.imageToViewportRectangle( rect );
	}
	if( overlay.placement ){
		return new OpenSeadragon.Overlay( 
				element, 
				drawer.viewport.pointFromPixel(rect), 
				OpenSeadragon.OverlayPlacement[overlay.placement.toUpperCase()]
				);
	}else{
		return new OpenSeadragon.Overlay( element, rect );
	}

}}}

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
				map.append("<img id='"+privateOverlays[i].id+"' src='images/mapcirclered_"+circleSize()+".png' class=\"poi user-poi\">");
				privateOverlays[i].placement = OpenSeadragon.OverlayPlacement.CENTER;
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
	privateOverlays.push(overlay);
	if (_GET["desc"]){
		$.jStorage.set("privateOverlays"+_GET["desc"], privateOverlays);
	} else {
		$.jStorage.set("privateOverlays", privateOverlays);
	}
	$("#map").append("<img id='private-"+overlay.id+"' src='images/mapcirclered_"+circleSize()+".png' class=\"poi user-poi\">");
	viewer.currentOverlays.push(addOverlayFromConfiguration(viewer.drawer, overlay));
	viewer.drawer.updateAgain = true;
	bindtooltip("private-"+overlay.id);
}}}

function addPOI(){{{
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
						id: "overlay-private-"+id
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

function tileToPixel(x, y){{{
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
}}}

function unlockCoords(){{{
	$("#btnLockCoords").one("click", lockCoords).html("Lock Coords").toggleClass("active");
	document.getElementById("map").onmousemove=updateCoords;
	var o = viewer.currentOverlays.filter(function(a, b){if (a.element.id.match(/^overlay-coordlock/)) return true; return false;});
	o = o[0];
	o.destroy();
	viewer.currentOverlays.splice(viewer.currentOverlays.indexOf(o), 1);
}}}
function lockCoords() {{{
	var notice = jNotice("Please choose a tile", function(){ $(".addPOI").remove(); }, $("#map"));
	var divAddPOI = $("<div class='addPOI'>&nbsp;</div>").appendTo($("#map")).one("click", function(e){
		var pixelTopLeft = new OpenSeadragon.Point(e.pageX-$("#map").position().left, e.pageY-$("#map").position().top);
		var pointTopLeft = viewer.viewport.pointFromPixel(pixelTopLeft);
		var px = Math.round(pointTopLeft.x*viewer.viewport.contentSize.x);
		var py = Math.round(pointTopLeft.y*viewer.viewport.contentSize.y*viewer.viewport.contentAspectX);
		var coords = pixelToTile(px, py);
		$(".addPOI").remove();
		lockCoordsAtTile(coords.x, coords.y);
		viewer.viewport.panTo(pointTopLeft);
		notice.remove();
	});
}}}
function lockCoordsAtTile(x, y) {{{
	$("<div class='addPOI'>&nbsp;</div>").appendTo($("#map"));
	document.getElementById("map").onmousemove=undefined;
	$("#btnLockCoords").unbind("click");
	$("#btnLockCoords").one("click", unlockCoords).html("Unlock Coords").toggleClass("active");
	var coords = tileToPixel(x, y);
	var overlay = {
		px: coords.x,
		py: coords.y + (tileHeight / 2),
		className: "highlight private",
		text: "Currently locked coordinates",
		id: "overlay-coordlock-"+(new Date() / 1000).toString()
	};
	//$("#map").append("<img id='"+overlay.id+"' src='images/mapcirclegreen_"+circleSize()+".png' class=\"poi coords-poi\">");
  $("#map").append(makePoiImage(overlay.id, "coords-poi")); 
	overlay.scales = false;
	overlay.placement = OpenSeadragon.OverlayPlacement.CENTER;
	viewer.currentOverlays.push(addOverlayFromConfiguration(viewer.drawer, overlay));
	viewer.drawer.updateAgain = true;
	$(".addPOI").remove();
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
					if ("x"+poi.comment != "x"){
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
	$.each(overlays, function(k,v){
		href=v.id.replace("overlay-","");
		map.append("<a id='"+v.id+"' href='#"+href+"'><img src='images/mapcircleblue_"+circleSize()+".png' class=\"poi global-poi\"></a>");
		v.placement = OpenSeadragon.OverlayPlacement.CENTER;
	});

	viewer = OpenSeadragon({
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
									map.append("<img id=\""+newoverlays[i].id+"\" src=\"images/mapcircleblue_"+circleSize()+".png\" class=\"poi global-poi\">");
									newoverlays[i].px += crds.x;
									newoverlays[i].py += crds.y;
									overlays.push(newoverlays[i]);
									newoverlays[i].placement = OpenSeadragon.OverlayPlacement.CENTER;
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
