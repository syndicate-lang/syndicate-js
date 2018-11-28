var svg = d3.select("svg#conversation-animation");
svg.attr("width", document.body.clientWidth);
svg.attr("height", document.body.clientHeight);

svg.append("defs").selectAll("marker")
  .data(["arrowhead", "arrowhead_actor"])
  .enter().append("marker")
    .attr("id", function(d) { return d; })
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", function (d) { return d === "arrowhead_actor" ? 125 : 25; })
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
  .append("path")
    .attr("d", "M0,-5L10,0L0,5 L0, -5")
    .style("stroke", "black")
    .style("opacity", "1");

var width = +svg.attr("width"),
    height = +svg.attr("height");

var color = d3.scaleOrdinal(d3.schemeCategory20);

var zoom = d3.zoom()
    .scaleExtent([1 / 16, 2])
    .wheelDelta(function () { return -d3.event.deltaY * (d3.event.deltaMode ? 60 : 1) / 500; })
    .filter(function () { return d3.event.type === 'wheel' || d3.event.button === 1; });

var initialTransform = d3.zoomIdentity.translate(width/2, height/2).scale(0.5);

svg.append("rect")
  .attr("width", width)
  .attr("height", height)
  .style("fill", "none")
  .style("pointer-events", "all")
  .call(zoom)
  .call(zoom.transform, initialTransform);

var g = svg.append("g").attr("transform", initialTransform),
    link = g.append("g").attr("stroke", "#000").attr("stroke-width", 1.5).selectAll(".link"),
    node = g.append("g").attr("stroke", "#fff").attr("stroke-width", 1.5).selectAll(".node");

zoom.on("zoom", function () { g.attr("transform", d3.event.transform) });

var simulation = d3.forceSimulation()
    .force("link", d3.forceLink()
           .distance(function(d) {
             if (d.target.type === "topic" && d.source.type === "actor") return 100;
             if (d.target.type === "topic" || d.source.type === "topic") return 5;
             if (d.target.type === "assertion" && d.source.type === "endpoint") return 10;
             if (d.target.type === "facet" && d.source.type === "facet") return 50;
             if (d.target.type === "facet" && d.source.type === "actor") return 50;
             if (d.target.type === "actor" && d.source.type === "actor") return 500;
             return 100;
           })
           .strength(function(d) {
             if (d.target.type === "actor" && d.source.type === "actor") return 0.1;
             return 0.5;
           })
           .id(function(d) { return d.id; }))
    .force("charge", d3.forceManyBody())
    .force("center", d3.forceCenter(0, 0))
    .on("tick", function () {
      link
        .attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });
      node.attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; });
    });

// function mkActor(n,c) { return {type: 'actor', id: n, color: c}; }
// function mkAssertion(n) { return {type: 'assertion', id: n}; }
// function mkLink(s,t,v) { return {source: s, target: t, value: v || 1}; }

var matchWeight = 10;

var graph = dataspaceContents;

// var clientCounter = 1;
// function clickHandler() {
//   var currentCounter = clientCounter;
//   clientCounter++;
//   var c = "Client" + currentCounter;
//   var n = "name" + currentCounter;

//   graph.nodes.push(mkActor(c, "#FFC0C0"));
//   graph.nodes.push(mkAssertion(entry(n,"127.0.0."+currentCounter)));
//   graph.nodes.push(mkAssertion(obs(entry(n,"*"))));
//   graph.nodes.push(mkAssertion(obs(laterThan(currentCounter))));

//   graph.edges.push(mkLink("Cache", obs(entry(n,"*"))));
//   graph.edges.push(mkLink("Server", entry(n,"127.0.0."+currentCounter)));
//   graph.edges.push(mkLink(c, obs(entry(n,"*"))));
//   graph.edges.push(mkLink("Cache", obs(laterThan(currentCounter))));

//   graph.edges.push(mkLink(entry(n,"127.0.0."+currentCounter), obs(entry(n,"*")), matchWeight));
//   graph.edges.push(mkLink(obs(entry(n,"*")), obs(obs(entry("*","*"))), matchWeight));
//   graph.edges.push(mkLink(obs(laterThan(currentCounter)), obs(obs(laterThan("*"))), matchWeight));

//   setTimeout(function () {
//     graph.nodes.splice(graph.nodes.findIndex(function (n) { return n.id === c; }), 1);
//     graph.edges.splice(graph.edges.findIndex(function (l) { return l.source.id === c; }), 1);
//     setupGraph();
//   }, 3000);

//   setupGraph();
// }

// svg.on("click", clickHandler);
// svg.on("doubleclick", clickHandler);

function setupGraph() {
  node = node.data(graph.nodes, function(d) { return d.id; });
  node.exit().remove();

  var group = node.enter().append("g")
      .attr("class", function(d) { return d.type; })
      .call(d3.drag()
            .on("start", dragstarted)
            .on("drag", dragged)
            .on("end", dragended));

  group.append("circle")
    .attr("r", function(d) {
      switch (d.type) {
        case "actor": return 60;
        case "facet": return 20;
        case "endpoint": return 10;
        default: return 5;
      }
    })
    .attr("fill", function(d) {
      switch (d.type) {
        case "actor": return "green";
        case "facet": return "cyan";
        case "topic": return "blue";
        case "endpoint": return "yellow";
        default: return d.color || "red";
      }
    })
    .on("click", function(d) {
      var text = d3.select('#label_' + d.id);
      text.style('opacity', text.style('opacity') == 1 ? 0 : 1);
      release_pinning(d);
    })

  group.append("text")
    .attr("id", function(d) { return 'label_' + d.id; })
    .attr("stroke", "none")
    .attr("text-anchor", function(d) {
      switch (d.type) {
        case "actor": return "middle";
        default: return "start";
      }
    })
    .attr("dx", function(d) {
      switch (d.type) {
        case "actor": return 0;
        case "facet": return 20;
        default: return 12;
      }
    })
    .attr("dy", ".35em")
    .style("pointer-events", "none")
    .style("opacity", 0)
    .text(function(d) { return d.label; });

  node = group.merge(node);

  link = link.data(graph.edges, function(d) { return d.source.id + "-" + d.target.id; });
  link.exit().remove();
  link = link.enter().append("line")
    .attr("stroke-width", 1)
    .style("marker-end", function (d) {
      if (!(d.dir === 'forward' || d.dir === 'both')) return void 0;
      // TODO: gross! Why don't I get d.target being an object here?
      if (d.target.startsWith('ac_')) return "url('#arrowhead_actor')";
      return "url('#arrowhead')";
    })
    .merge(link);

  // Update and restart the simulation.
  simulation.nodes(graph.nodes);
  simulation.force("link").links(graph.edges);
  simulation.alpha(3).restart();
}

function dragstarted(d) {
  if (!d3.event.active) simulation.alphaTarget(3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(d) {
  d.fx = d3.event.x;
  d.fy = d3.event.y;
}

function dragended(d) {
  if (!d3.event.active) simulation.alphaTarget(0);
  // d.fx = null;
  // d.fy = null;
}

function release_pinning(d) {
  d.fx = null;
  d.fy = null;
}

setupGraph();
