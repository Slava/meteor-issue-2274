(function(){Meteor.subscribe('test-publish');

Template.test.data = function() {
  doc = TestCollection.findOne()
  return doc ? doc.data : 'nothing'
}


})();
