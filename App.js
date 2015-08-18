Ext.define('iterRecord', {
    extend: 'Ext.data.Model',
    fields: [
        { name: 'Iteration', type: 'string' },
        { name: 'Estimate', type: 'int' },
        { name: 'Capacity', type: 'int' },
        { name: 'Loading', type: 'float' },
        { name: 'Average', type: 'float' }
    ]
});

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    items: [
        {
            xtype: 'container',
            id: 'header',
            layout: 'column',
            align: 'center',
            items: [
                {
                    xtype: 'rallydatefield',
                    id: 'StartDate',
                    stateful: true,
                    fieldLabel: 'Start Date',
                    value: Ext.Date.subtract( new Date(), Ext.Date.DAY, 90) // 90 days of previous iterations
                },
                {
                    xtype: 'rallydatefield',
                    fieldLabel: 'End Date',
                    stateful: true,
                    id: 'EndDate',
                    value: new Date()
                }
            ]
        },
        {
            xtype: 'container',
            id: 'body'
        }

    ],

    iterStore: null,
    iterationOIDs: [],

    _chartRefresh: function()
    {
        Ext.getCmp('CapChart').destroy();
        this.iterationOIDs = [];
        this.iterStore.destroyStore();
        this._startApp(this);
    },

    launch: function() {

        var app = this;

        Ext.getCmp('StartDate').on( {
            change: this._chartRefresh,
            scope: app
        });

        Ext.getCmp('EndDate').on( {
            change: this._chartRefresh,
            scope: app
        });

        app._startApp(app);
    },

    _startApp: function(app) {

        app.iterStore = Ext.create('Rally.data.wsapi.Store', {
            model: 'Iteration',
            autoLoad: 'true',
            filters: [
                {
                    property: 'StartDate',
                    operator: '>',
                    value: Ext.getCmp('StartDate').getValue()
                },
                {
                    property: 'StartDate',
                    operator: '<',
                    value: Ext.getCmp('EndDate').getValue()
                }
            ],
            sorters: [
                {
                    property: 'StartDate',
                    direction: 'ASC'
                }
            ],
            listeners: {
                load: function(store, data, success) {
                    _.each(data, function(record) {
                        app.iterationOIDs.push( { 'oid': record.get('Name') } );
                    });

                    // Now get utilisation entries
                    app._getUtilisation(app, app.iterationOIDs);
                }
            }
        });




    },

    _getUtilisation: function(app, iterationOIDs) {

        // Create a sequence of OR 'ed filters
        var oredFilters = [];

        _.each(iterationOIDs, function (objID) {
            oredFilters.push({ property: 'Iteration.Name', value: objID.oid});
        });

        utilsStore = Ext.create('Rally.data.wsapi.Store', {
            model: 'UserIterationCapacity',
            filters: Rally.data.wsapi.Filter.or(oredFilters),
            autoLoad: 'true',
            listeners: {
                load: function(store, data, success) {
                    var sortedIters = []; 
                    _.each(iterationOIDs, function(objID) {
                        sortedIters.push( _.filter(data,
                            function(record) {
                                return record.get('Iteration')._refObjectName == objID.oid; }
                            )
                        );
                    });
                    var summs = [];
                    _.each(sortedIters,
                        function(n) {
                            var lIter = n[0].get('Iteration')._refObjectName;
                            var lEsts = 0;
                            var lCaps = 0;
                            var lPcnt = 0;
                            _.each(n, function(p) { lEsts += p.get('TaskEstimates'); lCaps += p.get('Capacity'); });
                            lPcnt = (lEsts/(lCaps>0?lCaps:100000)) * 100;
                            summs.push(  {
                                    'Iteration': lIter,
                                    'Estimate': lEsts,
                                    'Capacity': lCaps,
                                    'Loading': lPcnt,
                                    'Average': 0 });
                    });

                    //Find the max utilisation for the chart
                    var loadMax = (Math.floor(_.max(_.pluck(summs,'Loading'))/50)+1) * 50;

                    //Now do least mean squares of load into load average
                    var results = app._leastSquares(_.pluck(summs, 'Loading'), 1, summs.length);
                    for ( i = 0; i < summs.length; i++){
                        summs[i].Average =  results.yintercept + ((i+1) * results.slope);
                    }

                    //Create a local store for the chart to play with
                    var rStore = Ext.create( 'Ext.data.Store', {
                        model: 'iterRecord',
                        data: summs,
                        proxy: 'memory'
                    });

                    var colors = [
                        '#f9a814',
                        '#ee6c19',
                        '#105cab',
                        '107c1e',
                        '#df1a7b',
                        '#4a1d7e'
                    ];

                    Ext.chart.theme.appTheme = Ext.extend(Ext.chart.theme.Base, {
                            constructor: function(config) {
                                Ext.chart.theme.Base.prototype.constructor.call(this, Ext.apply({
                                    colors: colors
                                }, config));
                            }
                        });

                    Ext.getCmp('body').add({
                        xtype: 'chart',
                        theme: 'appTheme',
                        id: 'CapChart',
                        store: rStore,
                        style: 'background:#fff',
                        animate: true,
                        autoShow: true,
                        height: 600,
                        width: 1024,
                        legend: {
                            position: 'bottom'
                        },
                        axes: [
                            {
                                type: 'Numeric',
                                position: 'left',
                                field: ['Estimate', 'Capacity'],
                                title: 'Task Hours',
                                grid: true
                            },
                            {
                                type: 'Category',
                                position: 'bottom',
                                fields: ['Iteration'],
                                title: 'Iteration'
                            },
                            {
                                type: 'Numeric',
                                position: 'right',
                                field: ['Loading','Average'],
                                title: 'Utilisation %',
                                grid: false,
                                minimum: 0,
                                maximum: loadMax
                            }
                        ],
                        series: [
                            {
                                type: 'column',
                                axis: 'left',
                                xField: 'Iteration',
                                yField: ['Estimate', 'Capacity'],
                                markerConfig: {
                                    type: 'cross',
                                    size: 3
                                },
                                tips: {
                                    trackMouse: true,
//                                    width: 140,
//                                    height: 28,
                                    renderer: app._tipsRenderer

                                }
                            },
                            {
                                type: 'line',
                                highlight: true,
                                smooth: true,
                                axis: 'right',
                                xField: 'Iteration',
                                yField: 'Loading',
                                markerConfig: {
                                    type: 'cross',
                                    size: 3
                                }
                            },
                            {
                                type: 'line',
                                axis: 'right',
                                highlight: true,
                                xField: 'Iteration',
                                yField: 'Average',
                                markerConfig: {
                                    type: 'circle',
                                    size: 3
                                }
                            }

                        ]
                    });

//                    Ext.getCmp('CapChart').on( {
//                        click: function() {
//                            Ext.create('Rally.ui.dialog.ConfirmDialog', {
//                                title: 'Save as JPEG',
//                                message: 'Save chart to file?',
//                                confirmLabel: 'Save',
//                                listeners: {
//                                    confirm: function(){
//                                        Ext.getCmp('CapChart').save({
//                                            type: 'image/jpeg'
//                                        });
//                                    }
//                                }
//                            });
//                        }
//                    });

                }
            },
            fetch: ['Capacity', 'Iteration', 'Load', 'TaskEstimates']
        });
    },

    _tipsRenderer: function(storeItem, item) {
        this.setTitle(item.yField);
        this.update(item.value[1]);
    },

    _leastSquares: function(todoValues, firstIndex, lastIndex) {
        var n = (lastIndex + 1) - firstIndex;
        var i;
        var sumx = 0.0, sumx2 = 0.0, sumy = 0.0, sumy2 = 0.0, sumxy = 0.0;
        var slope, yintercept;

        //Compute sums of x, x^2, y, y^2, and xy
        for (i = firstIndex; i <= lastIndex; i++) {
            sumx  = sumx  + i;
            sumx2 = sumx2 + i * i;
            sumy  = sumy  + todoValues[i-1];
            sumy2 = sumy2 + todoValues[i-1] * todoValues[i-1];
            sumxy = sumxy + i * todoValues[i-1];
        }
        slope = (n * sumxy - sumx * sumy) / (n * sumx2 - sumx * sumx);
        yintercept = (sumy * sumx2 - sumx * sumxy) / (n * sumx2 - sumx * sumx);

        return {slope: slope, yintercept: yintercept};
    }
});
