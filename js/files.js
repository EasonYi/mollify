/**
 * files.js
 *
 * Copyright 2008- Samuli Järvelä
 * Released under GPL License.
 *
 * License: http://www.mollify.org/license.php
 */

! function($, mollify) {
    mollify.registerModule({
        views: {
            // files parent view
            files: {
                templateFile: 'files',
                template: 'files',
                parent: "main",
                path: "/files",
                requiresAuthentication: true,

                ui: {
                    titleKey: 'files-view.title',
                    fa: 'fa-folder'
                },

                render: function(_m, c, m) {
                    this.render('files');
                    this.render('files-header-tools', {
                        into: 'main',
                        outlet: 'header-tools'
                    });
                    this.render('files-sidebar-nav', {
                        into: 'main',
                        outlet: 'sidebar-nav'
                    });
                },
                model: function() {
                    var viewTypes = [{
                        id: 'list',
                        type: 'list',
                        icon: 'list'
                    }, {
                        id: 'icon-small',
                        type: 'icon',
                        icon: 'th'
                    }, {
                        id: 'icon-large',
                        type: 'icon',
                        icon: 'th-large'
                    }];
                    return {
                        viewTypes: viewTypes,
                        viewType: null,
                        roots: this.filesystem.roots
                    };
                },
                routeActions: {
                    gotoFolder: function(item) {
                        if (item.is_file) return;
                        this.transitionTo("item", item.id);
                    }
                },
                controller: function() {
                    return Ember.ObjectController.extend({
                        needs: ['application', 'main'],
                        actions: {},

                        onViewTypeChange: function() {
                            var t = this.get('viewType');
                            if (!t) return;

                            var that = this;
                            if (t.type == 'list') {
                                var cols = [];
                                $.each(mollify.utils.getKeys(this._ctx.settings["list-view-columns"]), function(i, k) {
                                    var spec = mollify.filelist.columnsById[k];
                                    if (!spec) return;

                                    spec = $.extend({}, spec);
                                    spec.opts = $.extend({}, spec.opts, that._ctx.settings["list-view-columns"][k]);
                                    cols.push(spec);
                                });
                                this._ctx.filelist = {
                                    cols: cols
                                }
                            }
                        }.observes('viewType'),
                        isListView: function() {
                            return this.get('viewType').type == 'list';
                        }.property('viewType'),
                        isIconViewLarge: function() {
                            return this.get('viewType').id == 'icon-large';
                        }.property('viewType')
                    });
                },
                index: {
                    before: function(_m, transition) {
                        if (_m.filesystem.roots.length === 0) return;
                        this.transitionTo("item", _m.filesystem.roots[0].id);
                    }
                },
                setupController: function(controller, model) {
                    var _m = this;

                    // first setup
                    if (!controller._ctx) {
                        var settings = _m.settings['file-view'];

                        controller._ctx = {
                            _m: this,
                            settings: settings,
                            app: controller.get('controllers.application')
                        };
                    }
                    controller.set('viewType', controller.get('viewTypes')[0]);
                }
            },

            // item view (folder listing)
            item: {
                parent: "files",
                template: 'item',
                path: "/:id",
                requiresAuthentication: true,

                render: function(_m, c, m) {
                    this.render('item');
                    this.render('files-header-nav-items', {
                        into: 'main',
                        outlet: 'header-nav'
                    });
                    this.render('files-header-nav-tools', {
                        into: 'main',
                        outlet: 'header-tools-inner'
                    });
                },
                model: function(p) {
                    return {
                        id: p.id
                    };
                },
                controller: function() {
                    return Ember.ObjectController.extend({
                        needs: ['application', 'main', 'files'],
                        actions: {
                            createFolder: function() {
                                this.send("doAction", this._m.actions.all.createFolder, this.get('folder'));
                            },
                            clickItem: function(item, type, src) {
                                var ia = this.getItemAction(item, type);
                                if (ia === true) return;

                                if (ia == 'menu')
                                    this.showPopupMenu(item, src[0]);
                                else if (ia == 'gotoFolder')
                                    this.send("gotoFolder", item);
                                else if (this._m.actions.all[ia])
                                    this.send("doAction", this._m.actions.all[ia], item);
                            },
                            mouseOverItem: function(item, src) {
                                var that = this;

                                if (that._ctx.qa) that.closeQuickActions();
                                if (this.pendingQuickAction) {
                                    Ember.run.cancel(this.pendingQuickAction);
                                    this.pendingQuickAction = false;
                                }
                                this.pendingQuickAction = Ember.run.later(this, function() {
                                    this._ctx._m.actions.filesystem(item, this._ctx.fileview.settings["quick-actions"]).done(function(l) {
                                        that.set('quickActions', l); //TODO cache?
                                        that.set('quickActionCtx', item);

                                        that._ctx.qa = that._ctx.fileview.app.showPopupElement("filelist-quick-actions", that, {
                                            independent: true,
                                            pos: function($el) {
                                                //TODO pos on component itself?
                                                var pos = src.nameElement.offset();
                                                $el.css({
                                                    position: "absolute",
                                                    top: (pos.top) + "px",
                                                    left: (pos.left + src.nameElement.outerWidth()) + "px"
                                                });
                                            }
                                        });
                                    });
                                }, 400);
                            },
                            mouseOutFileComponent: function($t) {
                                if (this._ctx.qa && this._ctx.qa.$e) {
                                    var isMouseOverQa = ($t && (this._ctx.qa.$e == $t || $.contains(this._ctx.qa.$e[0], $t[0])));
                                    if (!isMouseOverQa) this.closeQuickActions();
                                }
                                if (this.pendingQuickAction) {
                                    Ember.run.cancel(this.pendingQuickAction);
                                    this.pendingQuickAction = false;
                                }
                            }
                        },

                        isWritable: function() {
                            var f = this.get('folder');
                            if (!f) return false;
                            return this._m.permissions.hasPermission('filesystem_item_access', f, 'rw');
                        }.property('model'),

                        onInit: function() {
                            this.closeQuickActions();
                            this.reload();
                        },

                        reload: function() {
                            this.set('loading', true);

                            var data = {};
                            if (this.get('controllers.files.isListView')) {
                                $.each(this._ctx.fileview.filelist.cols, function(i, c) {
                                    if (c.dataId) data[c.dataId] = {};
                                });
                            } else {
                                //icon
                            }
                            //TODO get from plugins/list component
                            var that = this;
                            var id = this.get('model.id');

                            this._m.filesystem.folderInfo(id, true, data).done(function(r) {
                                that.set('loading', false);

                                that.set('model', {
                                    id: id,
                                    folder: r.folder,
                                    items: r.folders.concat(r.files),
                                    folders: r.folders,
                                    files: r.files,
                                    root: r.hierarchy[0],
                                    hierarchy: r.hierarchy.slice(1),
                                    data: r.data,
                                    permissions: r.permissions
                                });
                            }).fail(function() {
                                that.set('loading', false);
                            });
                        },

                        closeQuickActions: function() {
                            if (this._ctx.qa) {
                                this.set('quickActions', []);
                                this._ctx.qa.close();
                                this._ctx.qa = false;
                            }
                        },

                        getItemAction: function(item, clickType) {
                            var handler = 'onClick';
                            var action = item.is_file ? 'info' : 'gotoFolder';

                            if (clickType == 'rightclick') {
                                handler = 'onRightClick';
                                action = 'menu';
                            } else if (clickType == 'doubleclick') {
                                handler = 'onDblClick';
                                action = item.is_file ? 'view' : 'gotoFolder';
                            }

                            if (this._ctx.fileview.settings.actions[handler]) {
                                var ctx = {}; //TODO
                                var customAction = this._ctx.fileview.settings.actions[handler](item, ctx);
                                if (customAction === true) return true;
                                if (customAction) action = customAction;
                            }
                            return action;
                        },
                        showPopupMenu: function(item, src) {
                            var that = this;
                            this._ctx.fileview.app.showPopupMenu(src.element, this._m.actions.filesystem(item), item, function(action) {
                                that.send("doAction", action, item);
                            });
                        },
                        onEvent: function(e) {
                            if (!e.type.startsWith('filesystem/')) return;

                            //TODO formatted message
                            var desc = '';
                            if (e.type == 'filesystem/upload') {
                                desc = e.payload.files.length;
                            } else {
                                var i = e.payload.items;

                                if (i.length == 1) desc = i[0].name;
                                else desc = i.length;
                            }
                            this._m.ui.notification.growlInfo(e.type + " " + desc);

                            //TODO update only changed items
                            this.send("gotoFolder", this.get('folder'));
                        }
                    });
                },

                setupController: function(controller, model) {
                    var _m = this;

                    // first setup
                    if (!controller._ctx) {
                        var settings = _m.settings['file-view'];

                        controller._ctx = {
                            _m: this,
                            fileview: controller.get('controllers.files')._ctx,
                            //settings: settings,
                            //app: controller.get('controllers.application'),
                            formatters: {
                                byteSize: new mollify.formatters.ByteSize(this.ui.texts, new mollify.formatters.Number(2, false, this.ui.texts.get('number.decimal-separator'))),
                                timestamp: new mollify.formatters.Timestamp(this.ui.texts.get('datetime.fmt.datetime-short')),
                                uploadSpeed: new mollify.formatters.Number(1, this.ui.texts.get('file-size.kbps'), this.ui.texts.get('number.decimal-separator'))
                            }
                        };

                        this.events.addEventHandler($.proxy(controller.onEvent, controller));

                        controller.uploadListener = {
                            start: function(files) {
                                console.log("start");
                                controller.send("showProgress", _m.ui.texts.get('main.files.upload.title', files.length));
                            },
                            progress: function(progress, bitrate) {
                                controller.set('controllers.main.progressMessage', progress + '%');
                                console.log("progress " + progress);
                            },
                            finished: function() {
                                console.log("finished");
                                Ember.run.later(controller, function() {
                                    this.send("hideProgress");
                                }, 2500);
                            },
                            failed: function() {
                                console.log("failed");
                                _m.ui.notification.growlError("todo upload failed");
                            }
                        };
                    }

                    controller.onInit();
                }
            }
        },

        actions: {
            // goto folder
            gotoFolder: {
                titleKey: 'actions.filesystem.goto-folder',
                fa: 'folder',
                type: 'filesystem-item',
                isApplicable: function(item) {
                    return !item.is_file;
                },
                handler: function(item) {
                    this.goto('item/' + item.id);
                }
            },
            // download
            download: {
                titleKey: 'actions.filesystem.download',
                fa: 'download',
                type: 'filesystem-item',
                isApplicable: function(item) {
                    return item.is_file && this.hasPermission('filesystem_item_access', item, 'r');
                },
                handler: function(item) {
                    if (!this._m.permissions.hasPermission('filesystem_item_access', item, 'r')) return;
                    this._m.ui.download(this._m.filesystem.getDownloadUrl(item));
                }
            },
            // info
            info: {
                titleKey: 'actions.filesystem.info',
                fa: 'info',
                type: 'filesystem-item',
                isApplicable: function(item) {
                    return this.hasPermission('filesystem_item_access', item, 'r');
                },
                handler: function(item) {
                    this.openModal('files-item-info', {
                        model: {
                            item: item
                        }
                    });
                }
            },
            //copy
            copy: {
                titleKey: 'actions.filesystem.copy',
                fa: 'copy',
                type: 'filesystem-item',
                isApplicable: function(item) {
                    return this.hasPermission('filesystem_item_access', item, 'r');
                },
                handler: function(item) {
                    window.alert(item.id);
                }
            },
            //delete
            delete: {
                titleKey: 'actions.filesystem.delete',
                fa: 'delete',
                type: 'filesystem-item',
                isApplicable: function(item) {
                    return this.hasPermission('filesystem_item_access', item, 'rw');
                },
                handler: function(item) {
                    this._m.filesystem.del(item);
                }
            },
            //create folder
            createFolder: {
                titleKey: 'actions.filesystem.create-folder',
                fa: 'folder',
                type: 'filesystem-item',
                isApplicable: function(item) {
                    return !item.is_file && this.hasPermission('filesystem_item_access', item, 'rw');
                },
                handler: function(item) {
                    var that = this;
                    this.openInputDialog({
                        title: "title",
                        message: "message",
                        yesTitle: "yes",
                        noTitle: "no",
                        isAcceptable: function(val) {
                            return val && val.length > 0;
                        },
                        onAccept: function(name) {
                            that._m.filesystem.createFolder(name);
                        }
                    });
                }
            }
        },

        itemInfo: {
            fileDetails: {
                isApplicable: function(item) {
                    return item.is_file;
                },
                template: 'item-info-file-details',
                controller: 'ItemInfoFileDetailsController',
                title: function(model) {
                    return "foo";
                }
            }
        },

        // module setup
        setup: function(App) {
            var _m = this;

            App.BsIconPill = Bootstrap.ItemView.extend(Bootstrap.NavItem, Bootstrap.ItemSelection, {
                template: Ember.Handlebars.compile('{{#if view.content.linkTo}}\n    {{#if view.parentView.dynamicLink}}\n        {{#link-to view.content.linkTo model}}{{view.title}}{{/link-to}}\n    {{else}}\n        {{#linkTo view.content.linkTo}}{{view.title}}{{/linkTo}}\n    {{/if}}\n{{else}}\n    {{view view.pillAsLinkView}}\n{{/if}}'),
                pillAsLinkView: Ember.View.extend({
                    tagName: 'a',
                    template: Ember.Handlebars.compile('{{#if view.parentView.content.icon}}<i class="fa fa-{{unbound view.parentView.content.icon}}"></i>{{else}}{{view.parentView.title}}{{/if}}'),
                    attributeBindings: ['href'],
                    href: "#"
                })
            });
            App.BsIconPills = Bootstrap.ItemsView.extend(Bootstrap.Nav, {
                navType: 'pills',
                classNameBindings: ['stacked:nav-stacked', 'justified:nav-justified'],
                attributeBindings: ['style'],
                itemViewClass: App.BsIconPill
            });
            Ember.Handlebars.helper('bs-icon-pills', App.BsIconPills);

            App.FileHeaderNavMenuComponent = Ember.Component.extend(App.FilesystemItemDroppable, {
                tagName: 'li',
                classNames: ['file-nav dropdown'],
                titleProperty: false,
                init: function() {
                    this._super();
                    var sel = this.get('selected');
                    this.droppableInit(sel);
                },
                actions: {
                    select: function(item) {
                        this.sendAction("select", item);
                    }
                }
            });

            App.FileListViewComponent = Ember.Component.extend({
                needs: ['application'],
                tagName: 'table',
                classNames: ['file-list-view table table-striped table-responsive'],
                actions: {
                    clickItem: function(item, type, src) {
                        var source = src || [];
                        source.push(this.getActionSource());
                        this.sendAction("clickItem", item, type, source);
                    },
                    colClick: function(col) {
                        var sortCol = this.get('sortCol');
                        if (sortCol.id == col.id) {
                            this.toggleProperty('sortAsc');
                        } else {
                            this.setProperties({
                                sortCol: col,
                                sortAsc: true
                            });
                        }
                    },
                    mouseOverItem: function(item, src) {
                        this.sendAction("mouseOverItem", item, src);
                    }
                },
                sorted: function() {
                    var sortCol = this.get('sortCol');
                    var asc = this.get('sortAsc');
                    var items = this.get('model.items');
                    var sorted = items ? items.slice(0) : [];
                    if (sortCol.sort) sorted.sort(function(i1, i2) {
                        return sortCol.sort(i1, i2, asc ? 1 : -1);
                    });
                    return sorted;
                }.property('sortCol', 'sortAsc', 'model'),

                getActionSource: function() {
                    return {
                        type: 'list',
                        element: this.$()
                    };
                },

                init: function() {
                    this._super();

                    var that = this;
                    this._ctx = this.get('targetObject._ctx');

                    var cols = that._ctx.fileview.filelist.cols;
                    this.set('cols', cols);
                    this.set('sortCol', cols[0]);
                    this.set('sortAsc', true);
                },

                didInsertElement: function() {
                    if (this._ctx._m.ui.uploader.initDesktopDND) this._ctx._m.ui.uploader.initDesktopDND(this.$(), this.get('folder'), this.get('targetObject'));
                },

                mouseLeave: function(e) {
                    this.sendAction("mouseOut", $(e.toElement || e.relatedTarget));
                }
            });

            App.FileListRowComponent = Ember.Component.extend(App.FilesystemItemDraggable, App.FilesystemItemDroppable, {
                tagName: 'tr',
                classNames: ['item'],
                classNameBindings: [],
                init: function() {
                    var item = this.get('item');
                    this._super(item);
                    this._ctx = this.get('targetObject._ctx');
                    this.quickActions = false;

                    if (item.is_file) {
                        this.classNames.push('file');
                        this.droppableInit(false);
                    } else {
                        this.classNames.push('folder')
                        this.droppableInit(item);
                    }
                },
                getActionSource: function() {
                    var $e = this.$();
                    return {
                        type: 'row',
                        element: $e,
                        nameElement: $e.find("td.name")
                    };
                },
                actions: {
                    clickItem: function(item, type, src) {
                        this.sendAction("clickItem", item, type, src ? [src, this.getActionSource()] : this.getActionSource());
                    }
                },
                mouseEnter: function(e) {
                    this.sendAction("mouseOver", this.get('item'), this.getActionSource());
                }
            });

            App.FileListCellComponent = Ember.Component.extend({
                tagName: 'td',
                classNames: ['file-list-cell'],
                classNameBindings: ['colId'],
                item: false,
                col: false,
                contentKey: '',
                init: function() {
                    this._super();
                    this._ctx = this.get('targetObject._ctx');

                    var item = this.get('item');
                    var col = this.get('col');
                    this.set('contentKey', item.id + '_' + col.id);
                    this.set('colId', col.id);
                },
                content: function() {
                    var item = this.get('item');
                    var col = this.get('col');
                    var data = this.get('data');

                    return col.content.apply(this._ctx, [item, data]);
                }.property('contentKey'), //TODO bind to actual property

                getActionSource: function() {
                    return {
                        type: 'col',
                        id: this.get('col').id,
                        element: this.$()
                    };
                },

                click: function(evt) {
                    if (this.clickAction) return;
                    var that = this;
                    this.clickAction = Ember.run.later({}, function() {
                        that.clickAction = false;
                        that.sendAction("clickItem", that.get('item'), 'click', that.getActionSource());
                    }, 200);
                },
                doubleClick: function(evt) {
                    if (this.clickAction) Ember.run.cancel(this.clickAction);
                    this.clickAction = false;
                    this.sendAction("clickItem", this.get('item'), 'doubleclick', this.getActionSource());
                },
                contextMenu: function(evt) {
                    this.sendAction("clickItem", this.get('item'), 'rightclick', this.getActionSource());
                    return false;
                }
            });

            App.FileIconViewComponent = Ember.Component.extend({
                classNames: ['file-icon-view'],
                classNameBindings: ['large:large']
            });

            // item info
            App.FilesItemInfoController = Ember.ObjectController.extend({
                classNames: ['item-info'],
                title: function() {
                    return this.get('item').name;
                },
                tabsMeta: Ember.A([]),
                defaultTab: '',
                actions: {},
                onShow: function() {
                    var that = this;
                    var model = this.get('model');

                    this._m.itemInfo.getApplicable(this.get('item')).done(function(l) {
                        var tabs = Ember.A([]);
                        var dt = false;
                        $.each(l, function(i, ii) {
                            var title = ii.title ? (typeof(ii.title) == 'function' ? ii.title.apply(that._m, [model]) : ii.title) : '';
                            if (!dt) dt = title;
                            tabs.push(Ember.Object.create({
                                title: title,
                                template: ii.template,
                                controller: ii.controller
                            }));
                        });
                        that.set('tabsMeta', tabs);
                        that.set('defaultTab', dt);
                    })
                }
            });

            App.ItemInfoFileDetailsController = Ember.ObjectController.extend({
                title: function(model) {
                    return "foo";
                }
            });
        }
    });

    // register file list columns
    mollify.filelist.registerColumn({
        id: "name",
        titleKey: "fileListColumnTitleName",
        sort: function(i1, i2, sort, data) {
            return i1.name.toLowerCase().localeCompare(i2.name.toLowerCase()) * sort;
        },
        content: function(item, data) {
            return item.name;
        }
    });
    mollify.filelist.registerColumn({
        id: "path",
        titleKey: "fileListColumnTitlePath",
        sort: function(i1, i2, sort, data) {
            var p1 = _m.filesystem.rootsById[i1.root_id].name + i1.path;
            var p2 = _m.filesystem.rootsById[i2.root_id].name + i2.path;
            return p1.toLowerCase().localeCompare(p2.toLowerCase()) * sort;
        },
        html: true,
        content: function(item, data) {
            return '<span class="item-path-root">' + this.filesystem.rootsById[item.root_id].name + '</span>: <span class="item-path-val">' + item.path + '</span>';
        }
    });
    mollify.filelist.registerColumn({
        id: "type",
        titleKey: "fileListColumnTitleType",
        sort: function(i1, i2, sort, data) {
            var e1 = i1.is_file ? (i1.extension || '') : '';
            var e2 = i2.is_file ? (i2.extension || '') : '';
            return e1.toLowerCase().localeCompare(e2.toLowerCase()) * sort;
        },
        content: function(item, data) {
            return item.is_file ? (item.extension || '') : '';
        }
    });
    mollify.filelist.registerColumn({
        id: "size",
        titleKey: "fileListColumnTitleSize",
        opts: {
            "min-width": 75
        },
        sort: function(i1, i2, sort, data) {
            var s1 = (i1.is_file ? parseInt(i1.size, 10) : 0);
            var s2 = (i2.is_file ? parseInt(i2.size, 10) : 0);
            return (s1 - s2) * sort;
        },
        content: function(item, data) {
            return item.is_file ? this.formatters.byteSize.format(item.size) : '';
        }
    });
    mollify.filelist.registerColumn({
        id: "file-modified",
        dataId: "core-file-modified",
        titleKey: "fileListColumnTitleLastModified",
        opts: {
            "width": 180
        },
        sort: function(i1, i2, sort, data) {
            if (!i1.is_file && !i2.is_file) return 0;
            if (!data || !data["core-file-modified"]) return 0;

            var ts1 = data["core-file-modified"][i1.id] ? data["core-file-modified"][i1.id] * 1 : 0;
            var ts2 = data["core-file-modified"][i2.id] ? data["core-file-modified"][i2.id] * 1 : 0;
            return ((ts1 > ts2) ? 1 : -1) * sort;
        },
        content: function(item, data) {
            if (!item.id || !item.is_file || !data || !data["core-file-modified"] || !data["core-file-modified"][item.id]) return "";
            return this.formatters.timestamp.format(mollify.utils.parseInternalTime(data["core-file-modified"][item.id]));
        }
    });
}(window.jQuery, window.mollify);
