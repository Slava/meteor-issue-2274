function fillCollection(count) {
  for(var i = 0; i < count; i++) {
    (function (i) {
      TestCollection.insert({
        data: "Dummy data #" + i,
        sortField: i,
        toDelete: true
      })
    })(i)
  }
}

function getLastId() {
  return TestCollection.findOne({}, {
    sort: { sortField: -1 }
  })._id;
}

function setFlags() {
  TestCollection.update(
    { _id: { $ne: getLastId() } },
    { $set: { toDelete: false } },
    { multi: 1 }
  );
}

function clear() {
  TestCollection.remove(
    { toDelete: true }
  );
}

Meteor.startup( function() {
  TestCollection.remove({});
  console.log("Waiting 10 seconds for client to subscribe");
  Meteor.setTimeout(function() {
    fillCollection(5);
    setFlags();
    clear();
  }, 10000);
});

Meteor.publish(
  'test-publish', function() {
    return TestCollection.find({}, {
      limit: 1,
      sort: { sortField: -1 }
    });
  }
);

