// ========================================================================
// SproutCore
// copyright 2006-2008 Sprout Systems, Inc.
// ========================================================================

require('server/server') ;

/** 
  @class
  
  Usually you wouldn't need to call any of the methods on this class or it's 
  superclass, except for calling the <tt>listFor</tt> method. The other
  methods are called for you when you work with your model objects. For
  example, calling <tt>myObject.commit();</tt> will call the
  <tt>commitRecords</tt> method on thisserver if you had defined this
  server to be to the <tt>dataSource</tt> of <tt>myObject</tt>.

  To have an SC model reflect data on a backend server attach an instance of 
  this class to your application. For example:

  {{{
    Contacts = SC.Object.create({
      server: SC.RestServer.create({ prefix: ['Contacts'] })
    }) ;
  }}}

  Then attach that server as the <tt>dataSource</tt> to each model class that
  you want to have reflected. Also define a <tt>resourceURL</tt> which defines
  the URL where the collection of your model can be queried. For example:

  {{{
    Contacts.Contact = SC.Record.extend(
      dataSource: Contacts.server,
      resourceURL: 'sc/contacts',
      properties: ['guid','firstName','lastName'],
      primaryKey: 'guid'
    }) ;
  }}}

  When you work with your models, behind the scenes SC will use 5 main methods 
  on this server. Each is listed below, together with the HTTP method used in 
  the call to the backend server and the URL that is being called. The URL is 
  based on the example given above.

  <dl>
    <dt>listFor</dt>
    <dd>GET /sc/contacts</dd>
    
    <dt>createRecords</dt>
    <dd>POST /sc/contacts</dd>
    
    <dt>refreshRecords for one record</dt>
    <dd>GET /sc/contacts/12345</dd>
  
    <dt>refreshRecords for many records</dt>
    <dd>GET /sc/contacts?ids=1,2,3,4,5,6</dd>
    
    <dt>commitRecords for one record</dt>
    <dd>PUT /sc/contacts/12345</dd>

    <dt>commitRecords for many records</dt>
    <dd>PUT /sc/contacts?ids=1,2,3,4,5</dd>
    
    <dt>destroyRecords for one record</dt>
    <dd>DELETE /sc/contacts/12345</dd>
    
    <dt>destroyRecords for many records</dt>
    <dd>DELETE /sc/contacts?ids=1,2,3,4,5</dd>
  </dl>

  The above is the default behaviour of this server. If you want different
  URLs to be generated then extend this class and override the
  <tt>request</tt> method.

  Another way to override the above is to tell SC where member resources can
  be refreshed, committed and destroyed. For example, when SC calls
  
  {{{
    GET /sc/contacts
  }}}
  
  you could reply as follows:

  {{{
    records: [
      {  guid: '123',
        type: "Contact",
        refreshURL: "/contacts?refresh=123",
        updateURL: "/contacts/123?update=Y",
        destroyURL: "/contacts/123",
        firstName: "Charles",
        ...
      }],
      ...
    }
  }}}

  Then when contact 123 needs to be refreshed later on by SC, it will call:

  {{{
    GET /contacts?refresh=123
  }}}

  instead of <tt>GET /contacts/123</tt>. Note that this only works for members
  on your resource. If a collection of contacts needed to be refreshed it
  would still call for example <tt>GET /contacts?id=123,456,789</tt> instead
  of making 3 separate calls.

  Via the <tt>SC.Server#request</tt> method you can also call collection and
  member functions on your resource. Use the <tt>action</tt> parameter for
  this. For example, 
  <tt>server.request('contacts', 'archive', null, params, 'delete')</tt>
  would call:

  {{{
    DELETE /contacts/archive
  }}}

  And
  <tt>server.request('contacts', 'give', [12345], {'amount': 1000}, 'put')</tt>
  would call:

  {{{
   PUT /contacts/12345/give
  }}}
  
  with post data <tt>amount=1000</tt>.

  Alternatively explicitely define the URL to use by setting the <tt>url</tt>
  property in the <tt>params</tt> argument that is passed to the 
  <tt>server.request</tt> method. For example:

  {{{
    Contacts.server.request(null,null,null, {url: '/sc/archive'}, 'delete')
  }}}

  would call:

  {{{
    DELETE /sc/archive
  }}}


  @extends SC.Server
  @author Lawrence Pit
  @copyright 2006-2008, Sprout Systems, Inc. and contributors.
  @since SproutCore 1.0
*/
SC.RestServer = SC.Server.extend({

  /**
    @see SC.Server.request
  **/
  request: function(resource, action, ids, params, method) {
    url = resource;
    if (ids && ids.length == 1) url = url + '/' + ids[0];
    if (action && action != '') url = url + '/' + action;
    params.url = url;

    sc_super();
  },


  /* privates, overrides the values in SC.Server */

  _listForAction: '',
  _listForMethod: 'get',

  _createAction: '',
  _createMethod: 'post',

  _refreshAction: '',
  _refreshMethod: 'get',

  _commitAction: '',
  _commitMethod: 'put',

  _destroyAction: '',
  _destroyMethod: 'delete'

}) ;
