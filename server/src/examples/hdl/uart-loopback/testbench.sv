`timescale 1ns / 1ps

// 回环测试：uart_tx 的输出直接接到 uart_rx 的输入。
// 发送一个字符串和 50 个随机字节，接收端逐个与发送队列比对（记分板）。
module tb;
  localparam CLKS_PER_BIT = 16;

  logic       clk = 0, rst = 1;
  logic       start = 0;
  logic [7:0] tx_data = 0;
  logic       line, busy;
  logic [7:0] rx_data;
  logic       rx_valid, frame_err;

  logic [7:0] sent [0:255];
  integer     n_sent = 0, n_recv = 0, errors = 0;

  uart_tx #(.CLKS_PER_BIT(CLKS_PER_BIT)) u_tx (
    .clk(clk), .rst(rst), .start(start), .data(tx_data), .tx(line), .busy(busy)
  );
  uart_rx #(.CLKS_PER_BIT(CLKS_PER_BIT)) u_rx (
    .clk(clk), .rst(rst), .rx(line), .data(rx_data), .valid(rx_valid), .frame_err(frame_err)
  );

  always #5 clk = ~clk;

  // 记分板：每收到一个字节就和发送顺序比对；前 12 个字节（字符串）拼起来显示
  logic [8*12-1:0] text = 0;
  always @(posedge clk) begin
    if (rx_valid) begin
      if (rx_data !== sent[n_recv] || frame_err) begin
        $display("[%0t] 错误：收到 %h，期望 %h（frame_err=%b）", $time, rx_data, sent[n_recv], frame_err);
        errors = errors + 1;
      end
      n_recv = n_recv + 1;
      if (n_recv <= 12) text = {text[8*11-1:0], rx_data};
      if (n_recv == 12) $display("接收端收到字符串：\"%s\"", text);
    end
  end

  task automatic send_byte(input logic [7:0] b);
    while (busy) @(negedge clk);
    tx_data = b;
    start   = 1;
    sent[n_sent] = b;
    n_sent = n_sent + 1;
    @(negedge clk);
    start = 0;
    @(negedge clk);
  endtask

  task automatic send_string(input string s);
    for (integer i = 0; i < s.len(); i = i + 1) send_byte(s[i]);
  endtask

  initial begin
    $dumpfile("dump.vcd");
    $dumpvars(0, tb);
    repeat (3) @(negedge clk);
    rst = 0;

    send_string("Hello, UART!");
    repeat (50) send_byte($random);
    while (busy) @(negedge clk);
    repeat (CLKS_PER_BIT * 2) @(negedge clk);

    $display("发送 %0d 字节，接收 %0d 字节", n_sent, n_recv);
    if (errors == 0 && n_recv == n_sent) $display("PASS: UART 回环数据全部一致");
    else                                 $display("FAIL: %0d 处错误", errors);
    $finish;
  end
endmodule
