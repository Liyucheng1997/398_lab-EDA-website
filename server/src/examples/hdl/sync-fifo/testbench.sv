`timescale 1ns / 1ps

// 定向测试（写满、读空、溢出保护）+ 1000 拍随机读写，用数组实现的参考队列做记分板
module tb;
  localparam WIDTH = 8, DEPTH = 8;

  logic             clk = 0, rst = 1;
  logic             wr_en = 0, rd_en = 0;
  logic [WIDTH-1:0] wr_data = 0, rd_data;
  logic             full, empty;
  logic [3:0]       count;

  // 参考模型：大数组 + 头尾索引
  logic [WIDTH-1:0] model [0:4095];
  integer head = 0, tail = 0;
  integer errors = 0, writes = 0, reads = 0;

  sync_fifo #(.WIDTH(WIDTH), .DEPTH(DEPTH)) dut (
    .clk(clk), .rst(rst), .wr_en(wr_en), .wr_data(wr_data), .rd_en(rd_en),
    .rd_data(rd_data), .full(full), .empty(empty), .count(count)
  );

  always #5 clk = ~clk;

  // 上升沿：按实际握手更新模型并比对读出数据（DUT 用非阻塞赋值，这里读到的仍是沿前的值）
  always @(posedge clk) begin
    if (!rst) begin
      if (rd_en && !empty) begin
        if (rd_data !== model[head]) begin
          $display("[%0t] 数据错误：读出 %h，期望 %h", $time, rd_data, model[head]);
          errors = errors + 1;
        end
        head  = head + 1;
        reads = reads + 1;
      end
      if (wr_en && !full) begin
        model[tail] = wr_data;
        tail   = tail + 1;
        writes = writes + 1;
      end
    end
  end

  // 下降沿：检查 count / full / empty 与模型一致
  always @(negedge clk) begin
    if (!rst) begin
      if (count !== tail - head || full !== (tail - head == DEPTH) || empty !== (tail == head)) begin
        $display("[%0t] 状态错误：count=%0d full=%b empty=%b，模型中有 %0d 项", $time, count, full, empty, tail - head);
        errors = errors + 1;
      end
    end
  end

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    repeat (2) @(negedge clk);
    rst = 0;

    // 1) 连续写 10 次：只有前 8 次成功，之后 full
    wr_en = 1;
    for (integer i = 0; i < 10; i = i + 1) begin
      wr_data = 8'hA0 + i[7:0];
      @(negedge clk);
    end
    wr_en = 0;
    if (!full) begin $display("错误：写满后 full 应为 1"); errors = errors + 1; end

    // 2) 连续读 10 次：读出 A0..A7，之后 empty
    rd_en = 1;
    repeat (10) @(negedge clk);
    rd_en = 0;
    if (!empty) begin $display("错误：读空后 empty 应为 1"); errors = errors + 1; end

    // 3) 随机读写
    repeat (1000) begin
      wr_en   = $random;
      rd_en   = $random;
      wr_data = $random;
      @(negedge clk);
    end
    wr_en = 0;
    rd_en = 1;
    repeat (DEPTH + 1) @(negedge clk);
    rd_en = 0;

    $display("共写入 %0d 项、读出 %0d 项", writes, reads);
    if (errors == 0 && writes == reads) $display("PASS: FIFO 数据顺序与满/空标志全部正确");
    else                                $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
