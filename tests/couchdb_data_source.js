

module("SC.CouchDBDataSource", {
  setup: function() {  
    var Sample = (window.Sample= SC.Object.create());
    Sample.File = SC.Record.extend({ test:'hello'});

    // files
    Sample.File.FIXTURES = [];
    
    var store = SC.Store.create().from(SC.Record.fixtures);
  }    
});