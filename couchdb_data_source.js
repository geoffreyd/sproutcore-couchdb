// ==========================================================================
// Project:   Couchdb
// Copyright: ©2009 My Company, Inc.
// ==========================================================================
/*globals Couchdb */

/** @class

  My cool new dataSource.  Allow access to couchDB server.
  
  @extends SC.DataSource
*/
SC.CouchdbDataSource = SC.DataSource.extend(
  /** @scope Couchdb.prototype */ {

  NAMESPACE: 'CouchdbDataSource',
  VERSION: '0.1.0',
  
  database: "",
  
  cache:{},

  requestCounter:0,
  cancelStoreKeys:{},

  fetchRequest: SC.Request.getUrl("").set('isJSON', YES),
  
  // ..........................................................
  // STANDARD DATA SOURCE METHODS
  //
  fetchRecords: function(store, fetchKey, params) {
    var ret = [], design, view;
    var url = this.get('database') ;
    
    if (fetchKey === SC.Record.STORE_KEYS) { // for a list of keys
      params.forEach(function(storeKey) {
        var recordType = SC.Store.recordTypeFor(storeKey),
            id = recordType.idFor(storeKey);
        url=url+'/'+id;
        var req = this.fetchRequest ;
        req.set('address', url);
        req.header("Content-Type", "application/json");
        req.header("If-None-Match", "1234");
        console.log(req);
        req.notify(this, this.fetchRecordDidComplete, { 
          store: store, fetchKey: fetchKey , storeKey: storeKey, id:id
        }).send();
        console.log(req);
        this.cancelStoreKeys[this.generateRequestId(storeKey)]=this.fetchRequest;
      }, this);
      ret = params ;
    } else {
      design = fetchKey.prototype.get("couchDesign") ;
      view = fetchKey.prototype.get("couchView") ;
      url = url+"/_design/"+design+"/_view/"+view;
      var req = this.fetchRequest ;
      req.set('address', url);
      req.header("Content-Type", "application/json");
      console.log(req);
      req.notify(this, this.fetchAllRecordsDidComplete, { 
        store: store, fetchKey: fetchKey , storeKeyArray: ret
      }).send();
    }
    return ret;
  },

  /**
    Removes the request from the queue if it is cancelled.

    @param {SC.Store} store the store
    @param {Number} storeKey the store key
    @returns {Boolean} YES if supported
  */
  cancel: function(store, storeKeys) {
    // TODO: The request manager should have methods to cancel request that are 
    // in the queue or are being procesed, instead of accesing directly the queue
    // In case that a connection hangs there is no option to abort it.
    var i, j;
    for (i in storeKeys) {
      for (j in this.cancelStoreKeys) {
        if (i.indexOf(j) != -1) {
          SC.Request.manager.get('queue').removeObject(this.cancelStoreKeys[j]);
          this.cancelStoreKeys[j]=null;
        }
      }
    }
    return YES;
  },
  
  createRequest: SC.Request.postUrl("").set('isJSON', YES),
  /**
    Issues a request to create a record using the hash corresponding to the
    storeKey

    @param {SC.Store} store the store
    @param {Number} storeKey the store key
    @returns {Boolean} YES if supported
  */
  createRecord: function(store, storeKey) {
    debugger;
    var dataHash   = store.readDataHash(storeKey);
    dataHash.type = store.recordTypeFor(storeKey).toString();
    var url = this.get('database') ;
    this.createRequest.set('address', url) ;
    // this.createRequest.set('');
    this.createRequest.notify(this, this.createRecordDidComplete, { 
      store: store, storeKey: storeKey 
    }).send(SC.json.encode(dataHash));
    this.cancelStoreKeys[this.generateRequestId(storeKey)]=this.createRequest;
    return YES ;
  },
  
  updateRequest: SC.Request.putUrl("tasks").set('isJSON', YES),
  /**
    Issues a request to update the record corresponding to the storeKey.

    @param {SC.Store} store the store
    @param {Number} storeKey the store key
    @returns {Boolean} YES if supported
  */
  updateRecord: function(store, storeKey) {
    var id         = store.idFor(storeKey),
        dataHash   = store.readDataHash(storeKey);

    this.updateRequest.notify(this, this.updateRecordDidComplete, { 
      store: store, storeKey: storeKey, id:id
    }).send(SC.json.encode(dataHash));
    this.cancelStoreKeys[this.generateRequestId(storeKey)]=this.updateRequest;  
    return YES ;
  },




  destroyRequest: SC.Request.deleteUrl("").set('isJSON', YES),
  /**
    Issues a request to delete the record corresponding to the storeKey

    @param {SC.Store} store the store
    @param {Number} storeKey the store key
    @returns {Boolean} YES if supported
  */
  destroyRecord: function(store, storeKey) {
    var id         = store.idFor(storeKey);

    if(!id) return YES;
    this.destroyRequest.set('address',id) ;
    this.destroyRequest.notify(this, this.destroyRecordDidComplete, { 
      store: store, storeKey: storeKey 
    }).send();
    this.cancelStoreKeys[this.generateRequestId(storeKey)]=this.destroyRequest;
    return YES ;
  },
  
  // callback methods

  /**
    Once the fetch request commint from store.retrieveRecords()
    is completed it handles the response and updates the store

    @param {SC.Request} fetch request
    @param {Object} hash with parameters {params.storeKey, params.store}
    @returns {Boolean} YES 
  */

  fetchRecordDidComplete: function(r,params) {
    var response, results, dataHash, storeKeys = [], hashes = [], primaryKey;
    var recordType = params.store.recordTypeFor(params.storeKey) ;
    primaryKey = recordType ? recordType.prototype.primaryKey : 'guid';
    response = r.response();
    results = response.rows;
    dataHash = results;
    dataHash[primaryKey] = dataHash._id ;
    hashes.push(dataHash);
    storeKeys.push(params.storeKey);
    params.store.dataSourceDidComplete(params.storeKey, dataHash, params.id);    
    params.storeKeyArray.replace(0,0,storeKeys);  
    return YES;
  },

  /**
    Once the fetch request comming from store.findAll()
    is completed it handles the response and updates the store

    @param {SC.Request} fetch request
    @param {Object} hash with parameters {params.store}
    @returns {Boolean} YES 
  */
  fetchAllRecordsDidComplete: function(r,params) {
    var hashes= [], storeKeys= [], dataHash, store, fetchKey, ret, primaryKey,
    response, results, lenresults, idx;
    fetchKey = params.fetchKey;
    primaryKey = fetchKey ? fetchKey.prototype.primaryKey : 'guid';
    response = r.response();
    results = response.rows;
    lenresults=results.length;
    for(idx=0;idx<lenresults;idx++) {      
      dataHash = results[idx].value;
      dataHash[primaryKey] = dataHash._id ;
      hashes.push(dataHash); 
    } 
    storeKeys = params.store.loadRecords(fetchKey, hashes);
    params.storeKeyArray.replace(0,0,storeKeys);
    //TODO: add error handling
    return YES;
  },
  
  /**
    Once the create request is completed it handles the response and updates the store

    @param {SC.Request} fetch request
    @param {Object} hash with parameters {params.storeKey, params.store}
    @returns {Boolean} YES 
  */

  createRecordDidComplete: function(r, params){
    var dataHash, response, results, guid, primaryKey;
    var recordType = params.store.recordTypeFor(params.storeKey) ;
    primaryKey = (recordType && recordType.prototype.primaryKey) ? recordType.prototype.primaryKey : "guid" ;
    dataHash = params.store.readDataHash(params.storeKey);
    response = r.response();
    dataHash[primaryKey] = response.id;
    dataHash._rev = response.rev;
    params.store.dataSourceDidComplete(params.storeKey, dataHash, dataHash.id);
    return YES;
  }

}) ;

