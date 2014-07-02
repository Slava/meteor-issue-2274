(function(){
UI.body.contentParts.push(UI.Component.extend({render: (function() {
  var self = this;
  return Spacebars.include(self.lookupTemplate("test"));
})}));
Meteor.startup(function () { if (! UI.body.INSTANTIATED) { UI.body.INSTANTIATED = true; UI.DomRange.insert(UI.render(UI.body).dom, document.body); } });

Template.__define__("test", (function() {
  var self = this;
  var template = this;
  return [ HTML.Raw("Sample data:<br>\n  "), function() {
    return Spacebars.mustache(self.lookup("data"));
  } ];
}));

})();
