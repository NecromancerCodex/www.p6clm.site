
export const buildGanttTree = (tasks) => {
    const groups = {};
    const rootNodes = [];

    // Helper: Find or create group node
    const getOrCreateGroup = (wbsCode, level) => {
        if (groups[wbsCode]) return groups[wbsCode];

        const parts = wbsCode.split('.');
        const name = parts[parts.length - 1]; // "C" from "A.B.C"
        const parentCode = parts.slice(0, -1).join('.');

        const groupNode = {
            id: `GROUP::${wbsCode}`,
            name: name,
            wbs_code: wbsCode,
            level: level,
            isGroup: true,
            children: [],
            start: null,
            end: null,
            progress: 0,
            expanded: true // Default expanded?
        };

        groups[wbsCode] = groupNode;

        if (parentCode) {
            const parent = getOrCreateGroup(parentCode, level - 1);
            // Check if already added to avoid duplicates in children array
            if (!parent.children.find(c => c.id === groupNode.id)) {
                parent.children.push(groupNode);
            }
        } else {
            // Root group
            if (!rootNodes.find(n => n.id === groupNode.id)) {
                rootNodes.push(groupNode);
            }
        }

        return groupNode;
    };

    // 1. Process Tasks and Assign to Groups
    tasks.forEach(task => {
        if (!task.wbs_code) {
             task.level = 0;
             rootNodes.push(task);
             return;
        }

        const parts = task.wbs_code.split('.');
        const parentGroup = getOrCreateGroup(task.wbs_code, parts.length - 1);
        
        task.level = parts.length;
        parentGroup.children.push(task);
    });

    // 2. Rollup Dates and Sort (Bottom-Up is tricky without recursion, use Post-Order traversal)
    // Simple recursive rollup
    const processNode = (node) => {
        if (!node.isGroup) {
            return { 
                start: node.start ? new Date(node.start).getTime() : null, 
                end: node.end ? new Date(node.end).getTime() : null,
                progress: node.progress || 0
            };
        }

        let minStart = Infinity;
        let maxEnd = -Infinity;
        let totalProgress = 0;
        let count = 0;

        // Sort children: Groups first? or by Name? Usually alphanumeric
        // node.children.sort((a, b) => a.name.localeCompare(b.name)); 

        node.children.forEach(child => {
            const stats = processNode(child);
            if (stats.start && stats.start < minStart) minStart = stats.start;
            if (stats.end && stats.end > maxEnd) maxEnd = stats.end;
            if (stats.start && stats.end) {
                // Determine duration weight for progress? Simple average for now
                totalProgress += stats.progress;
                count++;
            }
        });

        if (minStart !== Infinity) {
            node.start = new Date(minStart).toISOString().split('T')[0];
            node.end = new Date(maxEnd).toISOString().split('T')[0];
            node.progress = count > 0 ? totalProgress / count : 0;
        }

        return {
            start: minStart !== Infinity ? minStart : null,
            end: maxEnd !== -Infinity ? maxEnd : null,
            progress: node.progress
        };
    };

    rootNodes.forEach(processNode);
    
    return rootNodes;
};

export const flattenTree = (nodes, expandedIds) => {
    let result = [];
    
    const traverse = (node) => {
        result.push(node);
        if (node.isGroup && expandedIds.has(node.id)) {
            // Sort children
            // WBS ordering is implicitly handled by insertion order usually, 
            // but we might want to sort by ID or Name
            // node.children.sort... (Already sorted roughly)
            node.children.forEach(traverse);
        }
    };

    nodes.forEach(traverse);
    return result;
};
