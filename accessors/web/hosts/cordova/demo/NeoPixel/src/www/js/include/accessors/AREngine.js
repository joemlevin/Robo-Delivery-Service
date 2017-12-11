// This is the AR Engine Accessor
var AR = require('@accessors-modules/wikitude');  // Acquire the Wikitube module as the AR interface.
var key ="ucUHghOxI+30wb8LoegIszD0BZm51S4jSwxHgAUvOsHyTPfDQhCyM76X469mOk2UVbPuS5zO5wrotYGfWXkCWLSc2LFq55c5QZg7gmBzzpRrrlxVgkfOhkidsdVo3X0kU+HVdb9BQBtwcyp1nwshUZ2tNcUBEIMAZKRiYT2bRklTYWx0ZWRfX+9DHzpS2/6pxX0Cv0KS7dcCCRoAIdJLYY6NeWHceGMN1RoTqjVsX/CIIVe/L820/tNxabJ6jsOuk566+AVgUw8SFs+AZfOn+obqSfx5MGkdjWEUNnu0nTdVLshw30hkUj7Zsff954JSkhMnILUktSVR5bAdGY1YdZDhR3udEHrJeBtJc8xRHuTRaGFjqTLJEYsF/TpjG33RsXZ9oZPBIkQ7jdZ+HJ3osXy1WYnkehO1sOHaBS1Dh8FtdRcIzID+DB/UFJblSbH8AAx+CNRp/mQXF0SNvVwQz8WtKVWaNGGGIxtbj+tCShRJSaDZWzy2hX/KsGKO8AQkZcZogxy9mO/0vr+53jg0KQdVIfMyiIOLd5TqczUlDI63hEg9jDivRWU0izqaFAfEt1YfA9kZCwKTxJhpgLGCPI+6XadUrabfnmXV2F7m7JAhdbROOskfvaiiMnlZAGAmJaDabEKiCkSN7mXyheg1ng669yhwthwKa+6bJt6F/0c=";
exports.setup = function(){
	// Detection
	this.output('tag_id');
	// ConstructingUI
	this.input('html');
	this.output('post');
	var spont = this.instantiate('sp', 'test/TestSpontaneousOnce');
	spont.setParameter('delay', 1000.0);
	spont.setParameter('value', 1);
	this.connect(spont, 'output', 'tag_id');
}
exports.initialize = function() {
	// Detection
	var settings = {
		"callback_func": function (AR_image_id){
			// Translate AR_image_id to tag_id
			var tag_id = AR_image_id; //Potentially change this such that it doesn't depend on AR values
			this.send('tag_id', tag_id);
		}
	};
	// AR.startDetection(settings);
	// ConstructUI
	this.addInputHandler('html', function (){
		var accessor_html = this.get('html');
		var options = {
			'UI_input_handler': function(command){
				this.send('command', command); // If this works wow
			}
		};
		// BEGIN TEMPORARY CODE TO TEST INTEGRATION
		ui = document.getElementById('ui');
    ui.innerHTML = accessor_html;
    var thiz = this;
    document.getElementById('form').addEventListener("submit", function() {
        x = document.getElementById('form').elements["show"].value;
        var message = {'message': {'show': x}};
        thiz.send('post', message);
    });
		// END TEMPORARY CODE TO TEST INTEGRATION
		// AR.renderUI(accessor_html, options);
	});
	AR.setLicenseKey(key);
	var customArchitectWorld = {
			"path": "www/world.html",
			"requiredFeatures": [
					"image_tracking",
					"geo"
			],
			"startupConfiguration": {
					"camera_position": "back"
			}
	};
	AR.StartAR(customArchitectWorld);
}
